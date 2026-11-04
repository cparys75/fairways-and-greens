import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { SeasonProvider } from './season';
import { StandingsPage } from './pages/Standings';
import { ResultsPage } from './pages/Results';
import { ScheduleMatchPage, SchedulePage } from './pages/Schedule';
import { HandicapsPage } from './pages/Handicaps';
import { PlayerPage } from './pages/Player';
import { RecordsPage } from './pages/Records';
import { StatsPage } from './pages/Stats';
import { RulesPage } from './pages/Rules';
import { AdminLayout } from './admin/AdminLayout';
import { ScoreEntryPage } from './admin/ScoreEntry';
import { ScheduleEditorPage } from './admin/ScheduleEditor';
import { RosterPage } from './admin/Roster';
import { SettingsPage } from './admin/Settings';
import { SeasonsPage } from './admin/Seasons';
import { NewSeasonPage } from './admin/NewSeason';
import { AccountsPage } from './admin/Accounts';
import { HomePage } from './pages/Home';
import { BoardPage } from './pages/Board';
import { ProfilePage } from './pages/Profile';
import { PrivacyPage } from './pages/Privacy';
import { ContactsPage } from './admin/Contacts';
import { LeaguePage } from './admin/League';
import { SitePage } from './admin/Site';
const GreenMapperPage = lazy(() => import('./admin/GreenMapper'));
import { JoinPage, LeaguesPage } from './pages/Leagues';
import { MatchCardPage, PlayPage } from './pages/Play';
import { MyRoundsPage, RoundPage } from './pages/MyRounds';
import { GuestRoundPage } from './pages/GuestRound';
import { LeagueLayout } from './components/Layout';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <SeasonProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route element={<LeagueLayout />}>
              <Route path="standings" element={<StandingsPage />} />
              <Route path="results" element={<ResultsPage />} />
              <Route path="results/:week" element={<ResultsPage />} />
              <Route path="schedule" element={<SchedulePage />} />
              <Route path="schedule/:week/:idx" element={<ScheduleMatchPage />} />
              <Route path="handicaps" element={<HandicapsPage />} />
              <Route path="players/:id" element={<PlayerPage />} />
              <Route path="records" element={<RecordsPage />} />
              <Route path="stats" element={<StatsPage />} />
              <Route path="rules" element={<RulesPage />} />
              <Route path="board" element={<BoardPage />} />
            </Route>
            <Route path="profile" element={<ProfilePage />} />
            <Route path="leagues" element={<LeaguesPage />} />
            <Route path="join/:code" element={<JoinPage />} />
            <Route path="play" element={<PlayPage />} />
            <Route path="play/:week" element={<MatchCardPage />} />
            <Route path="rounds" element={<MyRoundsPage />} />
            <Route path="rounds/new" element={<RoundPage />} />
            <Route path="rounds/:id" element={<RoundPage />} />
            <Route path="privacy" element={<PrivacyPage />} />
            <Route path="g/:token" element={<GuestRoundPage />} />
            {/* Older links */}
            <Route path="signin" element={<Navigate to="/" replace />} />
            <Route path="me" element={<Navigate to="/play" replace />} />
            <Route path="me/rounds" element={<Navigate to="/rounds" replace />} />
            <Route path="admin" element={<AdminLayout />}>
              <Route index element={<ScoreEntryPage />} />
              <Route path="scores/:week" element={<ScoreEntryPage />} />
              <Route path="schedule" element={<ScheduleEditorPage />} />
              <Route path="roster" element={<RosterPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="seasons" element={<SeasonsPage />} />
              <Route path="new-season" element={<NewSeasonPage />} />
              <Route path="league" element={<LeaguePage />} />
              <Route path="site" element={<SitePage />} />
              <Route path="greens" element={<Suspense fallback={<p className="empty">Loading map…</p>}><GreenMapperPage /></Suspense>} />
              <Route path="accounts" element={<AccountsPage />} />
              <Route path="contacts" element={<ContactsPage />} />
              <Route path="password" element={<Navigate to="/admin" replace />} />
            </Route>
            <Route path="*" element={<p className="empty">Page not found.</p>} />
          </Route>
        </Routes>
      </SeasonProvider>
    </BrowserRouter>
  </StrictMode>,
);

// Offline support for scoring on the course (production builds only, so development isn't cached).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js'));
}
