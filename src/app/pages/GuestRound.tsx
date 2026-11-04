import { useParams } from 'react-router';
import { LiveRound } from './LiveRound';
import { BRAND } from '../../brand';

/** /g/<token>: a guest's link to one round. No account or sign-in needed. */
export function GuestRoundPage() {
  const { token = '' } = useParams();
  return (
    <main className="wrap guest-round">
      <header className="guest-head">
        <img className="brand-mark" src={BRAND.logoMark} alt="" width={30} height={30} />
        <strong>{BRAND.name}</strong>
      </header>
      <LiveRound source={{ kind: 'guest', token }} />
    </main>
  );
}
