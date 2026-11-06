import { useSession } from '../lib/session';

/** Shown where a signed-in reporter is needed: one button that opens the World ID sign-in. */
export function SignInCard({ why }: { why: string }) {
  const { openSignIn } = useSession();
  return (
    <div className="signin-card">
      <p className="muted">{why}</p>
      <button className="primary" onClick={openSignIn}>
        Sign in with World ID
      </button>
    </div>
  );
}
