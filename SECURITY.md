# Security Policy

## Reporting a vulnerability

Please report security issues **privately**, not in a public issue.

- Use GitHub's **"Report a vulnerability"** button under the repository's
  **Security** tab (Private vulnerability reporting), or
- open a minimal public issue that says only "security issue, please enable a
  private channel" without details, and a maintainer will follow up.

Include enough to reproduce: affected version/commit, steps, and the impact.
Describe the class of problem rather than posting a working exploit. We'll
acknowledge the report, work on a fix, and credit you if you'd like once it's
resolved.

## Scope and good to know

- **Secrets never live in this repository.** API keys, OAuth client secrets and
  VAPID keys are supplied through environment variables / the Cloudflare
  dashboard. If you believe a secret was committed, report it privately.
- Each deployment is independent: a vulnerability in one self-hosted instance
  does not expose another's data.
- The app is designed to sit behind sign-in; league pages are visible only to
  that league's members and admins.

## Supported versions

This is a community project without formal releases yet; fixes land on `main`.
Please deploy from a recent `main`.
