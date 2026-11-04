import { Link } from 'react-router';
import { BRAND } from '../../brand';

/** A plain-language privacy policy. Reachable without signing in. */
export function PrivacyPage() {
  return (
    <main className="wrap legal">
      <h1>Privacy</h1>
      <p className="muted small">How {BRAND.name} handles your information. Last updated November 2026.</p>

      <h2>What this is</h2>
      <p>{BRAND.name} is a private web app for running a golf league. You need an account to use it, and only league members and admins can see a league’s pages.</p>

      <h2>What we collect</h2>
      <ul>
        <li><strong>Account:</strong> your name and email, and a password if you didn’t sign in with Google.</li>
        <li><strong>Optional:</strong> a mobile phone number and whether you agree to league texts, if you add them.</li>
        <li><strong>Golf:</strong> your scores, rounds you record (including anyone you keep score for), and league results.</li>
        <li><strong>Technical:</strong> a sign-in cookie to keep you logged in. We don’t use advertising or third-party tracking.</li>
      </ul>

      <h2>Location (GPS)</h2>
      <p>The distance-to-green feature reads your phone’s location only while you have it turned on, and only to show distances on your own screen. Your location is never sent to our server or stored.</p>

      <h2>Who can see your information</h2>
      <ul>
        <li>Your <strong>name</strong> is visible to other members of your league (on standings, scorecards and the message board).</li>
        <li>Your <strong>email and phone</strong> are visible only to your league’s admins, for running the league.</li>
        <li>Rounds you record for yourself are private to you and anyone you added to that round.</li>
        <li>We don’t sell your information or share it with anyone outside your league.</li>
      </ul>

      <h2>Where it’s stored</h2>
      <p>Data is stored with Cloudflare (hosting and database) and, if you sign in with Google, Google handles that sign-in. A weekly backup is kept privately for 90 days so we can recover from mistakes.</p>

      <h2>Notifications</h2>
      <p>If you turn on notifications, we store the subscription your browser gives us so we can send alerts (such as a new message or a match reminder). Turn them off any time in your profile.</p>

      <h2>Your choices</h2>
      <ul>
        <li><strong>Download your data:</strong> get a copy of everything we hold about you from your <Link to="/profile">Profile</Link>.</li>
        <li><strong>Delete your account:</strong> remove your account and your data from your Profile at any time. Rounds other people started that included you keep your name but are no longer linked to you.</li>
      </ul>

      <h2>Contact</h2>
      <p>Questions about your data? Contact your league’s admin.</p>
      <p className="small"><Link to="/">← Back</Link></p>
    </main>
  );
}
