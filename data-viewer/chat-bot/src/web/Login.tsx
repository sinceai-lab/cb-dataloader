// Signing in happens on Keycloak's own page, so no password is ever typed into this app.
export function Login() {
  return (
    <div className="login">
      <img className="logo" src="/logo-apetit.png" alt="Apetit" />
      <h1>Climate &amp; Nature Navigator</h1>
      <p>
        Sign in to chat with the Apetit data. The assistant acts as you: the entities it can read, and
        whether it can change anything at all, follow the roles on your account.
      </p>
      <a className="signin" href="/login">
        Sign in with Keycloak
      </a>
    </div>
  );
}
