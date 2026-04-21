import { CurrencyBar } from '@ui/components/CurrencyBar';

// Build timestamp - update when deploying
const BUILD_DATE = '18.02 13:20';

export function HeaderBar() {
  return (
    <header className="header-bar">
      <h1>CULT.MERGE <span style={{ fontSize: '0.6em', opacity: 0.6 }}>({BUILD_DATE})</span></h1>
      <CurrencyBar />
    </header>
  );
}
