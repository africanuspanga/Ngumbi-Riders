'use client';

import { useEffect, useState } from 'react';
import {
  useForm,
  type UseFormRegister,
  type UseFormSetValue,
  type FieldErrors,
  type FieldError,
} from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  applicationSchema,
  STEP_FIELDS,
  identityTypeValues,
  type ApplicationInput,
  type IdentityType,
} from '@/lib/validation/application';
import {
  requiredApplicantDocTypes,
  GUARANTOR_DOC_TYPES,
} from '@/lib/applications/documents';
import { REGION_NAMES, districtsOf } from '@/lib/geo/tanzania';
import { Stepper } from '@/components/forms/Stepper';
import { TextField, TextAreaField, SelectField } from '@/components/forms/Field';
import { SignaturePad } from '@/components/forms/SignaturePad';
import { FileInput } from '@/components/forms/FileInput';

type Translate = ReturnType<typeof useTranslations>;
// Translate a react-hook-form error via its stable message key, falling back to
// a generic message for any un-keyed built-in validation.
type ErrorT = (e?: FieldError) => string | undefined;

const STEP_KEYS = [
  'personal',
  'contact',
  'identity',
  'experience',
  'guarantor',
  'documents',
  'declaration',
  'review',
] as const;

const DOCUMENTS_STEP = STEP_KEYS.indexOf('documents');

const DRAFT_KEY = 'ngr-apply-draft-v1';

// The applicant's required identity documents depend on the chosen identity
// type (build spec #3); the guarantor always uploads the same set.
function requiredDocKeys(identityType: IdentityType): string[] {
  return [
    ...requiredApplicantDocTypes(identityType).map((t) => `applicant.${t}`),
    ...GUARANTOR_DOC_TYPES.map((t) => `guarantor.${t}`),
  ];
}

export function ApplicationForm() {
  const t = useTranslations('apply');
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [signature, setSignature] = useState('');
  const [docError, setDocError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Set once the application row is created; document uploads resume from
  // here on retry instead of re-submitting (and duplicating) the application.
  const [submission, setSubmission] = useState<{ reference: string; uploadToken: string } | null>(
    null,
  );

  const te: ErrorT = (e) => {
    if (!e) return undefined;
    const key = `errors.${e.message}`;
    return t.has(key) ? t(key) : t('errors.generic');
  };

  const {
    register,
    watch,
    trigger,
    getValues,
    setValue,
    reset,
    formState: { errors },
    handleSubmit,
  } = useForm<ApplicationInput>({
    resolver: zodResolver(applicationSchema),
    mode: 'onTouched',
    // signature is a canvas, not a registered input — seed it so an un-drawn
    // signature validates as '' ("required") instead of undefined.
    defaultValues: { gender: undefined, signature: '', identityType: 'nida', region: '', district: '' },
  });

  const identityType = (watch('identityType') as IdentityType) ?? 'nida';
  const region = watch('region') ?? '';

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw) as Record<string, unknown>;
        // The signature canvas cannot be re-hydrated from a draft: restoring
        // the saved dataURL into form state would let the applicant submit a
        // signature they cannot SEE (the pad renders blank from its own
        // state). Drop it — they must re-draw, and validation asks them to.
        draft.signature = '';
        reset(draft as Parameters<typeof reset>[0]);
      }
    } catch {
      /* ignore corrupt draft */
    }
  }, [reset]);

  function saveDraft() {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(getValues()));
    } catch {
      /* storage may be unavailable */
    }
  }

  function setFile(key: string, file: File | null) {
    setFiles((prev) => ({ ...prev, [key]: file }));
  }

  function handleSignatureChange(dataUrl: string) {
    setSignature(dataUrl);
    setValue('signature', dataUrl, { shouldValidate: false });
  }

  function missingDocs(): string[] {
    return requiredDocKeys(identityType).filter((k) => !files[k]);
  }

  async function next() {
    setDocError(null);
    const fields = STEP_FIELDS[step];
    if (fields && fields.length > 0) {
      const valid = await trigger([...fields] as (keyof ApplicationInput)[]);
      if (!valid) return;
    }
    if (step === DOCUMENTS_STEP && missingDocs().length > 0) {
      setDocError(t('docs.missing'));
      return;
    }
    saveDraft();
    setStep((s) => Math.min(s + 1, STEP_KEYS.length - 1));
  }

  function back() {
    setDocError(null);
    setStep((s) => Math.max(s - 1, 0));
  }

  async function onSubmit(data: ApplicationInput) {
    setSubmitError(null);
    if (missingDocs().length > 0) {
      setStep(DOCUMENTS_STEP);
      setDocError(t('docs.missing'));
      return;
    }
    setSubmitting(true);
    try {
      let sub = submission;
      if (!sub) {
        const fd = new FormData();
        fd.append('payload', JSON.stringify(data));
        const res = await fetch('/api/applications', { method: 'POST', body: fd });
        const result = await res.json();
        if (!res.ok) {
          if (result?.error === 'rate_limited') setSubmitError(t('errors.rateLimited'));
          else if (result?.error === 'duplicate') setSubmitError(t('errors.duplicate'));
          else setSubmitError(t('errors.submitFailed'));
          return;
        }
        sub = { reference: result.reference, uploadToken: result.uploadToken };
        setSubmission(sub);
      }

      // Upload each required document individually (platform request-size cap).
      for (const key of requiredDocKeys(data.identityType)) {
        const file = files[key];
        if (!file) continue;
        const dot = key.indexOf('.');
        const scope = key.slice(0, dot);
        const docType = key.slice(dot + 1);
        const fd = new FormData();
        fd.append('token', sub.uploadToken);
        fd.append('scope', scope);
        fd.append('docType', docType);
        fd.append('file', file, file.name);
        const res = await fetch('/api/applications/documents', { method: 'POST', body: fd });
        if (!res.ok) {
          const result = await res.json().catch(() => null);
          if (result?.error === 'file_rejected') {
            setSubmitError(t('errors.fileRejected'));
            setStep(DOCUMENTS_STEP);
          } else {
            setSubmitError(t('errors.submitFailed'));
          }
          return;
        }
      }

      sessionStorage.removeItem(DRAFT_KEY);
      router.push(`/apply/success?ref=${encodeURIComponent(sub.reference)}`);
    } catch {
      setSubmitError(t('errors.network'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6">
      <Stepper current={step} total={STEP_KEYS.length} label={t(`steps.${STEP_KEYS[step]}`)} />

      <div className="flex flex-col gap-4">
        {step === 0 && <PersonalStep t={t} te={te} register={register} errors={errors} />}
        {step === 1 && (
          <ContactStep t={t} te={te} register={register} errors={errors} region={region} setValue={setValue} />
        )}
        {step === 2 && <IdentityStep t={t} te={te} register={register} errors={errors} identityType={identityType} />}
        {step === 3 && <ExperienceStep t={t} te={te} register={register} errors={errors} />}
        {step === 4 && <GuarantorStep t={t} te={te} register={register} errors={errors} />}
        {step === 5 && (
          <DocumentsStep t={t} files={files} setFile={setFile} error={docError} identityType={identityType} />
        )}
        {step === 6 && (
          <DeclarationStep t={t} te={te} register={register} errors={errors} signature={signature} setSignature={handleSignatureChange} />
        )}
        {step === 7 && <ReviewStep t={t} values={getValues()} files={files} />}
      </div>

      {submitError && (
        <p role="alert" className="text-sm font-medium text-overdue">
          {submitError}
        </p>
      )}

      {submission && (
        // The application row already exists server-side; a resubmit only
        // retries the document uploads. Edits made by walking back would be
        // silently discarded (and could desync docs from the stored identity
        // type) — so once submitted, navigation locks and we say so.
        <p className="rounded-[--radius-card] border border-border bg-surface p-3 text-sm text-primary-dark">
          {t('errors.alreadySubmitted')}
        </p>
      )}

      <div className="flex gap-3">
        {step > 0 && !submission && (
          <button type="button" onClick={back} className="flex-1 rounded-[--radius-card] border border-border bg-white px-4 py-3 font-semibold text-primary-dark">
            {t('nav.back')}
          </button>
        )}
        {step < STEP_KEYS.length - 1 ? (
          <button type="button" onClick={next} className="flex-1 rounded-[--radius-card] bg-primary px-4 py-3 font-semibold text-white hover:bg-primary-hover">
            {t('nav.continue')}
          </button>
        ) : (
          <button type="submit" disabled={submitting} className="flex-1 rounded-[--radius-card] bg-primary px-4 py-3 font-semibold text-white hover:bg-primary-hover disabled:opacity-60">
            {submitting ? t('nav.submitting') : t('nav.submit')}
          </button>
        )}
      </div>
    </form>
  );
}

type StepProps = {
  t: Translate;
  te: ErrorT;
  register: UseFormRegister<ApplicationInput>;
  errors: FieldErrors<ApplicationInput>;
};

function PersonalStep({ t, te, register, errors }: StepProps) {
  return (
    <>
      <TextField label={t('fields.firstName')} required error={te(errors.firstName)} {...register('firstName')} />
      <TextField label={t('fields.middleName')} error={te(errors.middleName)} {...register('middleName')} />
      <TextField label={t('fields.lastName')} required error={te(errors.lastName)} {...register('lastName')} />
      <TextField label={t('fields.dob')} type="date" required error={te(errors.dateOfBirth)} {...register('dateOfBirth')} />
      <SelectField label={t('fields.gender')} required error={te(errors.gender)} defaultValue="" {...register('gender')}>
        <option value="" disabled>{t('fields.genderChoose')}</option>
        <option value="male">{t('fields.genderMale')}</option>
        <option value="female">{t('fields.genderFemale')}</option>
      </SelectField>
    </>
  );
}

function ContactStep({
  t,
  te,
  register,
  errors,
  region,
  setValue,
}: StepProps & { region: string; setValue: UseFormSetValue<ApplicationInput> }) {
  const districts = districtsOf(region);
  return (
    <>
      <TextField label={t('fields.phone')} type="tel" inputMode="tel" required hint={t('fields.phoneHint')} error={te(errors.primaryPhone)} {...register('primaryPhone')} />
      <TextField label={t('fields.altPhone')} type="tel" inputMode="tel" error={te(errors.alternativePhone)} {...register('alternativePhone')} />
      <TextField label={t('fields.email')} type="email" error={te(errors.email)} {...register('email')} />
      {/* Region/district are dependent dropdowns (build spec #5). Changing the
          region clears the district so a stale pairing can't be submitted. */}
      <SelectField
        label={t('fields.region')}
        required
        error={te(errors.region)}
        defaultValue=""
        {...register('region', {
          onChange: () => setValue('district', '', { shouldValidate: false }),
        })}
      >
        <option value="" disabled>{t('fields.regionChoose')}</option>
        {REGION_NAMES.map((r) => (
          <option key={r} value={r}>{r}</option>
        ))}
      </SelectField>
      <SelectField label={t('fields.district')} required error={te(errors.district)} defaultValue="" disabled={!region} {...register('district')}>
        <option value="" disabled>{region ? t('fields.districtChoose') : t('fields.districtPickRegion')}</option>
        {districts.map((d) => (
          <option key={d} value={d}>{d}</option>
        ))}
      </SelectField>
      <TextField label={t('fields.ward')} required error={te(errors.ward)} {...register('ward')} />
      <TextField label={t('fields.street')} required error={te(errors.street)} {...register('street')} />
      <TextAreaField label={t('fields.fullAddress')} required error={te(errors.fullAddress)} {...register('fullAddress')} />
    </>
  );
}

function IdentityStep({
  t,
  te,
  register,
  errors,
  identityType,
}: StepProps & { identityType: IdentityType }) {
  return (
    <>
      <SelectField label={t('fields.identityType')} required error={te(errors.identityType)} defaultValue="nida" {...register('identityType')}>
        {identityTypeValues.map((v) => (
          <option key={v} value={v}>{t(`fields.idType.${v}`)}</option>
        ))}
      </SelectField>
      <TextField
        label={t(`fields.identityNumber.${identityType}`)}
        inputMode={identityType === 'nida' ? 'numeric' : 'text'}
        required
        hint={identityType === 'nida' ? t('fields.nidaHint') : undefined}
        error={te(errors.identityNumber)}
        {...register('identityNumber')}
      />
      {/* Driving licence is optional unless it IS the identity document. */}
      {identityType !== 'driving_licence' && (
        <TextField
          label={t('fields.licenceOptional')}
          hint={t('fields.licenceOptionalHint')}
          error={te(errors.drivingLicenceNumber)}
          {...register('drivingLicenceNumber')}
        />
      )}
    </>
  );
}

function ExperienceStep({ t, te, register, errors }: StepProps) {
  return (
    <>
      <TextAreaField label={t('fields.experience')} error={te(errors.previousExperience)} {...register('previousExperience')} />
      <TextField label={t('fields.emergencyName')} required error={te(errors.emergencyContactName)} {...register('emergencyContactName')} />
      <TextField label={t('fields.emergencyPhone')} type="tel" inputMode="tel" required error={te(errors.emergencyContactPhone)} {...register('emergencyContactPhone')} />
      <TextField label={t('fields.emergencyRelationship')} required error={te(errors.emergencyContactRelationship)} {...register('emergencyContactRelationship')} />
    </>
  );
}

function GuarantorStep({ t, te, register, errors }: StepProps) {
  const e = errors.guarantor;
  return (
    <>
      <p className="text-sm text-muted-foreground">{t('fields.guarantorIntro')}</p>
      <TextField label={t('fields.gFullName')} required error={te(e?.fullName)} {...register('guarantor.fullName')} />
      <TextField label={t('fields.gPhone')} type="tel" inputMode="tel" required hint={t('fields.gPhoneHint')} error={te(e?.phone)} {...register('guarantor.phone')} />
      <TextField label={t('fields.gNida')} inputMode="numeric" required error={te(e?.nidaNumber)} {...register('guarantor.nidaNumber')} />
      <TextField label={t('fields.gAddress')} required error={te(e?.residentialAddress)} {...register('guarantor.residentialAddress')} />
      <TextField label={t('fields.gRelationship')} required error={te(e?.relationship)} {...register('guarantor.relationship')} />
      <TextField label={t('fields.gOccupation')} required error={te(e?.occupation)} {...register('guarantor.occupation')} />
      <TextField label={t('fields.gEmployer')} error={te(e?.employer)} {...register('guarantor.employer')} />
    </>
  );
}

function DocumentsStep({
  t,
  files,
  setFile,
  error,
  identityType,
}: {
  t: Translate;
  files: Record<string, File | null>;
  setFile: (key: string, file: File | null) => void;
  error: string | null;
  identityType: IdentityType;
}) {
  // Translated (sw/en) file-rejection copy — FileInput's built-in defaults are
  // Swahili-only, which mistranslated rejections for English-locale applicants.
  const rejectionMessages = {
    type: t('docs.fileType'),
    extension: t('docs.fileExtension'),
    size: t('docs.fileSize'),
    empty: t('docs.fileEmpty'),
  };
  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-3">
        <h3 className="font-semibold text-primary-dark">{t('docs.applicantHeading')}</h3>
        {requiredApplicantDocTypes(identityType).map((type) => (
          <FileInput
            key={`applicant.${type}`}
            label={t(`docs.applicant.${type}`)}
            required
            file={files[`applicant.${type}`] ?? null}
            onSelect={(f) => setFile(`applicant.${type}`, f)}
            rejectionMessages={rejectionMessages}
          />
        ))}
      </section>
      <section className="flex flex-col gap-3">
        <h3 className="font-semibold text-primary-dark">{t('docs.guarantorHeadingSingle')}</h3>
        {GUARANTOR_DOC_TYPES.map((type) => (
          <FileInput
            key={`guarantor.${type}`}
            label={t(`docs.guarantor.${type}`)}
            required
            file={files[`guarantor.${type}`] ?? null}
            onSelect={(f) => setFile(`guarantor.${type}`, f)}
            rejectionMessages={rejectionMessages}
          />
        ))}
      </section>
      {error && (
        <p role="alert" className="text-sm font-medium text-overdue">
          {error}
        </p>
      )}
    </div>
  );
}

function DeclarationStep({
  t,
  te,
  register,
  errors,
  signature,
  setSignature,
}: StepProps & { signature: string; setSignature: (s: string) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-[--radius-card] bg-surface p-3 text-sm text-primary-dark">
        {t('declaration.text')}
      </p>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1 h-5 w-5" {...register('declarationAccepted')} />
        <span>{t('declaration.checkbox')}</span>
      </label>
      {errors.declarationAccepted && (
        <span role="alert" className="text-xs font-medium text-overdue">
          {te(errors.declarationAccepted)}
        </span>
      )}
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-foreground">{t('declaration.signature')} *</span>
        <SignaturePad value={signature} onChange={setSignature} clearLabel={t('declaration.clear')} />
        {errors.signature && (
          <span role="alert" className="text-xs font-medium text-overdue">
            {te(errors.signature)}
          </span>
        )}
      </div>
    </div>
  );
}

function ReviewStep({
  t,
  values,
  files,
}: {
  t: Translate;
  values: ApplicationInput;
  files: Record<string, File | null>;
}) {
  const uploaded = Object.values(files).filter(Boolean).length;
  return (
    <div className="flex flex-col gap-3 text-sm">
      <Row label={t('review.name')} value={`${values.firstName ?? ''} ${values.lastName ?? ''}`} />
      <Row label={t('review.phone')} value={values.primaryPhone} />
      <Row label={t('review.regionDistrict')} value={`${values.region ?? ''} / ${values.district ?? ''}`} />
      <Row label={t('review.identity')} value={values.identityType ? t(`fields.idType.${values.identityType}`) : '—'} />
      <Row label={t('review.guarantors')} value="1" />
      <Row label={t('review.uploaded')} value={`${uploaded}`} />
      <p className="mt-2 text-muted-foreground">{t('review.note')}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border pb-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium text-foreground">{value || '—'}</span>
    </div>
  );
}
