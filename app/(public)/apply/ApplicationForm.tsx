'use client';

import { useEffect, useState } from 'react';
import { useForm, type UseFormRegister, type FieldErrors } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import {
  applicationSchema,
  STEP_FIELDS,
  type ApplicationInput,
} from '@/lib/validation/application';
import {
  APPLICANT_DOC_TYPES,
  GUARANTOR_DOC_TYPES,
} from '@/lib/applications/documents';
import { Stepper } from '@/components/forms/Stepper';
import { TextField, TextAreaField, SelectField } from '@/components/forms/Field';
import { SignaturePad } from '@/components/forms/SignaturePad';
import { FileInput } from '@/components/forms/FileInput';

const STEP_LABELS = [
  'Taarifa binafsi',
  'Mawasiliano na anuani',
  'NIDA na leseni',
  'Uzoefu na dharura',
  'Mdhamini wa kwanza',
  'Mdhamini wa pili',
  'Nyaraka',
  'Tamko na sahihi',
  'Kagua na tuma',
];

const DRAFT_KEY = 'ngr-apply-draft-v1';

// Required document keys: applicant + both guarantors.
const REQUIRED_DOC_KEYS = [
  ...APPLICANT_DOC_TYPES.map((t) => `applicant.${t}`),
  ...GUARANTOR_DOC_TYPES.map((t) => `guarantorOne.${t}`),
  ...GUARANTOR_DOC_TYPES.map((t) => `guarantorTwo.${t}`),
];

export function ApplicationForm() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [signature, setSignature] = useState('');
  const [docError, setDocError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    trigger,
    getValues,
    setValue,
    reset,
    formState: { errors },
    handleSubmit,
  } = useForm<ApplicationInput>({
    resolver: zodResolver(applicationSchema),
    mode: 'onTouched',
    defaultValues: { gender: undefined },
  });

  // Restore text draft for this device session (spec §8.6). Files are not
  // persisted and must be re-selected.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (raw) reset(JSON.parse(raw));
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

  function missingDocs(): string[] {
    return REQUIRED_DOC_KEYS.filter((k) => !files[k]);
  }

  async function next() {
    setDocError(null);
    const fields = STEP_FIELDS[step];
    if (fields && fields.length > 0) {
      const valid = await trigger([...fields] as (keyof ApplicationInput)[]);
      if (!valid) return;
    }
    if (step === 6 && missingDocs().length > 0) {
      setDocError('Tafadhali pakia nyaraka zote zinazohitajika.');
      return;
    }
    if (step === 7) {
      setValue('signature', signature, { shouldValidate: true });
      const valid = await trigger(['declarationAccepted', 'signature']);
      if (!valid) return;
    }
    saveDraft();
    setStep((s) => Math.min(s + 1, STEP_LABELS.length - 1));
  }

  function back() {
    setDocError(null);
    setStep((s) => Math.max(s - 1, 0));
  }

  async function onSubmit(data: ApplicationInput) {
    setSubmitError(null);
    if (missingDocs().length > 0) {
      setStep(6);
      setDocError('Tafadhali pakia nyaraka zote zinazohitajika.');
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('payload', JSON.stringify(data));
      for (const [key, file] of Object.entries(files)) {
        if (file) fd.append(`doc:${key}`, file, file.name);
      }
      const res = await fetch('/api/applications', {
        method: 'POST',
        body: fd,
      });
      const result = await res.json();
      if (!res.ok) {
        if (result?.error === 'rate_limited') {
          setSubmitError('Umejaribu mara nyingi. Tafadhali subiri kidogo.');
        } else if (result?.error === 'file_rejected') {
          setSubmitError('Faili moja au zaidi halikubaliki. Kagua nyaraka zako.');
          setStep(6);
        } else {
          setSubmitError('Imeshindikana kutuma maombi. Jaribu tena.');
        }
        return;
      }
      sessionStorage.removeItem(DRAFT_KEY);
      router.push(`/apply/success?ref=${encodeURIComponent(result.reference)}`);
    } catch {
      setSubmitError('Hitilafu ya mtandao. Jaribu tena.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6">
      <Stepper current={step} total={STEP_LABELS.length} label={STEP_LABELS[step]!} />

      <div className="flex flex-col gap-4">
        {step === 0 && <PersonalStep register={register} errors={errors} />}
        {step === 1 && <ContactStep register={register} errors={errors} />}
        {step === 2 && <NidaStep register={register} errors={errors} />}
        {step === 3 && <ExperienceStep register={register} errors={errors} />}
        {step === 4 && <GuarantorStep prefix="guarantorOne" register={register} errors={errors} />}
        {step === 5 && <GuarantorStep prefix="guarantorTwo" register={register} errors={errors} />}
        {step === 6 && (
          <DocumentsStep files={files} setFile={setFile} error={docError} />
        )}
        {step === 7 && (
          <DeclarationStep
            register={register}
            errors={errors}
            signature={signature}
            setSignature={setSignature}
          />
        )}
        {step === 8 && <ReviewStep values={getValues()} files={files} />}
      </div>

      {submitError && (
        <p role="alert" className="text-sm font-medium text-overdue">
          {submitError}
        </p>
      )}

      <div className="flex gap-3">
        {step > 0 && (
          <button
            type="button"
            onClick={back}
            className="flex-1 rounded-[--radius-card] border border-border bg-white px-4 py-3 font-semibold text-primary-dark"
          >
            Rudi
          </button>
        )}
        {step < STEP_LABELS.length - 1 ? (
          <button
            type="button"
            onClick={next}
            className="flex-1 rounded-[--radius-card] bg-primary px-4 py-3 font-semibold text-white hover:bg-primary-hover"
          >
            Endelea
          </button>
        ) : (
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 rounded-[--radius-card] bg-primary px-4 py-3 font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
          >
            {submitting ? 'Inatuma…' : 'Tuma maombi'}
          </button>
        )}
      </div>
    </form>
  );
}

type StepProps = {
  register: UseFormRegister<ApplicationInput>;
  errors: FieldErrors<ApplicationInput>;
};

function PersonalStep({ register, errors }: StepProps) {
  return (
    <>
      <TextField label="Jina la kwanza" required error={errors.firstName} {...register('firstName')} />
      <TextField label="Jina la kati" error={errors.middleName} {...register('middleName')} />
      <TextField label="Jina la mwisho" required error={errors.lastName} {...register('lastName')} />
      <TextField label="Tarehe ya kuzaliwa" type="date" required error={errors.dateOfBirth} {...register('dateOfBirth')} />
      <SelectField label="Jinsia" required error={errors.gender} defaultValue="" {...register('gender')}>
        <option value="" disabled>Chagua…</option>
        <option value="male">Mwanaume</option>
        <option value="female">Mwanamke</option>
      </SelectField>
    </>
  );
}

function ContactStep({ register, errors }: StepProps) {
  return (
    <>
      <TextField label="Namba ya simu" type="tel" inputMode="tel" required hint="Mfano: 0712 345 678" error={errors.primaryPhone} {...register('primaryPhone')} />
      <TextField label="Namba nyingine ya simu" type="tel" inputMode="tel" error={errors.alternativePhone} {...register('alternativePhone')} />
      <TextField label="Barua pepe" type="email" error={errors.email} {...register('email')} />
      <TextField label="Mkoa" required error={errors.region} {...register('region')} />
      <TextField label="Wilaya" required error={errors.district} {...register('district')} />
      <TextField label="Kata" required error={errors.ward} {...register('ward')} />
      <TextField label="Mtaa" required error={errors.street} {...register('street')} />
      <TextAreaField label="Anuani kamili" required error={errors.fullAddress} {...register('fullAddress')} />
    </>
  );
}

function NidaStep({ register, errors }: StepProps) {
  return (
    <>
      <TextField label="Namba ya NIDA" inputMode="numeric" required hint="Tarakimu 20" error={errors.nidaNumber} {...register('nidaNumber')} />
      <TextField label="Namba ya leseni ya udereva" required error={errors.drivingLicenceNumber} {...register('drivingLicenceNumber')} />
    </>
  );
}

function ExperienceStep({ register, errors }: StepProps) {
  return (
    <>
      <TextAreaField label="Uzoefu wa kuendesha pikipiki" error={errors.previousExperience} {...register('previousExperience')} />
      <TextField label="Jina la mtu wa dharura" required error={errors.emergencyContactName} {...register('emergencyContactName')} />
      <TextField label="Simu ya mtu wa dharura" type="tel" inputMode="tel" required error={errors.emergencyContactPhone} {...register('emergencyContactPhone')} />
      <TextField label="Uhusiano" required error={errors.emergencyContactRelationship} {...register('emergencyContactRelationship')} />
    </>
  );
}

function GuarantorStep({
  prefix,
  register,
  errors,
}: StepProps & { prefix: 'guarantorOne' | 'guarantorTwo' }) {
  const e = errors[prefix];
  return (
    <>
      <p className="text-sm text-muted">Taarifa za mdhamini. Wadhamini wawili wanahitajika.</p>
      <TextField label="Jina kamili" required error={e?.fullName} {...register(`${prefix}.fullName`)} />
      <TextField label="Namba ya simu" type="tel" inputMode="tel" required error={e?.phone} {...register(`${prefix}.phone`)} />
      <TextField label="Namba ya NIDA" inputMode="numeric" required hint="Tarakimu 20" error={e?.nidaNumber} {...register(`${prefix}.nidaNumber`)} />
      <TextField label="Anuani ya makazi" required error={e?.residentialAddress} {...register(`${prefix}.residentialAddress`)} />
      <TextField label="Uhusiano na muombaji" required error={e?.relationship} {...register(`${prefix}.relationship`)} />
      <TextField label="Kazi" required error={e?.occupation} {...register(`${prefix}.occupation`)} />
      <TextField label="Mwajiri au biashara" error={e?.employer} {...register(`${prefix}.employer`)} />
    </>
  );
}

const APPLICANT_DOC_LABELS: Record<string, string> = {
  nida_front: 'NIDA (mbele)',
  nida_back: 'NIDA (nyuma)',
  licence: 'Leseni ya udereva',
  photo: 'Picha ya pasipoti',
  declaration: 'Tamko lililosainiwa',
};
const GUARANTOR_DOC_LABELS: Record<string, string> = {
  photo: 'Picha ya pasipoti',
  nida_front: 'NIDA (mbele)',
  nida_back: 'NIDA (nyuma)',
  declaration: 'Tamko la mdhamini',
};

function DocumentsStep({
  files,
  setFile,
  error,
}: {
  files: Record<string, File | null>;
  setFile: (key: string, file: File | null) => void;
  error: string | null;
}) {
  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-3">
        <h3 className="font-semibold text-primary-dark">Nyaraka za muombaji</h3>
        {APPLICANT_DOC_TYPES.map((t) => (
          <FileInput
            key={`applicant.${t}`}
            label={APPLICANT_DOC_LABELS[t]!}
            required
            file={files[`applicant.${t}`] ?? null}
            onSelect={(f) => setFile(`applicant.${t}`, f)}
          />
        ))}
      </section>
      {(['guarantorOne', 'guarantorTwo'] as const).map((g, i) => (
        <section key={g} className="flex flex-col gap-3">
          <h3 className="font-semibold text-primary-dark">
            Nyaraka za mdhamini {i + 1}
          </h3>
          {GUARANTOR_DOC_TYPES.map((t) => (
            <FileInput
              key={`${g}.${t}`}
              label={GUARANTOR_DOC_LABELS[t]!}
              required
              file={files[`${g}.${t}`] ?? null}
              onSelect={(f) => setFile(`${g}.${t}`, f)}
            />
          ))}
        </section>
      ))}
      {error && (
        <p role="alert" className="text-sm font-medium text-overdue">
          {error}
        </p>
      )}
    </div>
  );
}

function DeclarationStep({
  register,
  errors,
  signature,
  setSignature,
}: StepProps & { signature: string; setSignature: (s: string) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-[--radius-card] bg-surface p-3 text-sm text-primary-dark">
        Ninathibitisha kuwa taarifa nilizotoa ni za kweli na sahihi. Natambua
        kuwa taarifa za uongo zinaweza kusababisha maombi yangu kukataliwa.
      </p>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1 h-5 w-5" {...register('declarationAccepted')} />
        <span>Nakubali masharti na tamko hapo juu.</span>
      </label>
      {errors.declarationAccepted && (
        <span role="alert" className="text-xs font-medium text-overdue">
          {errors.declarationAccepted.message}
        </span>
      )}
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-foreground">Sahihi *</span>
        <SignaturePad value={signature} onChange={setSignature} />
        {errors.signature && (
          <span role="alert" className="text-xs font-medium text-overdue">
            {errors.signature.message}
          </span>
        )}
      </div>
    </div>
  );
}

function ReviewStep({
  values,
  files,
}: {
  values: ApplicationInput;
  files: Record<string, File | null>;
}) {
  const uploaded = Object.values(files).filter(Boolean).length;
  return (
    <div className="flex flex-col gap-3 text-sm">
      <Row label="Jina" value={`${values.firstName ?? ''} ${values.lastName ?? ''}`} />
      <Row label="Simu" value={values.primaryPhone} />
      <Row label="Mkoa/Wilaya" value={`${values.region ?? ''} / ${values.district ?? ''}`} />
      <Row label="Wadhamini" value="2" />
      <Row label="Nyaraka zilizopakiwa" value={`${uploaded}`} />
      <p className="mt-2 text-muted">
        Hakikisha taarifa zote ni sahihi kabla ya kutuma. Baada ya kutuma
        utapata namba ya kumbukumbu.
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border pb-2">
      <span className="text-muted">{label}</span>
      <span className="text-right font-medium text-foreground">{value || '—'}</span>
    </div>
  );
}
