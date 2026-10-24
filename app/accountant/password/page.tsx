import { requireAccountant } from '@/lib/auth/session';
import { ChangePasswordForm } from '@/components/staff/ChangePasswordForm';

export const metadata = { title: 'Change password' };

/** A staff member changes their own sign-in password. */
export default async function ChangePasswordPage() {
  await requireAccountant();
  return (
    <div className="flex max-w-lg flex-col gap-5">
      <header>
        <h1>Change password</h1>
        <p className="text-sm text-muted-foreground">
          You will still need the SMS code each time you sign in. Changing your password signs out
          every other device you are signed in on.
        </p>
      </header>
      <section className="rounded-(--radius-card) border border-border bg-white p-5">
        <ChangePasswordForm />
      </section>
    </div>
  );
}
