import { lazy, Suspense } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

const previews = {
  dice: lazy(() => import('./previews/DicePreview')),
  board: lazy(() => import('./previews/BoardPreview')),
  effects: lazy(() => import('./previews/EffectsPreview')),
  players: lazy(() => import('./previews/PlayersPreview')),
  casino: lazy(() => import('./previews/CasinoEntryPreview')),
  bank: lazy(() => import('./previews/BankPreview')),
} satisfies Record<string, LazyExoticComponent<ComponentType>>;

type PreviewId = keyof typeof previews;

const options: readonly { id: PreviewId; label: string; description: string }[] = [
  { id: 'dice', label: '3D ダイス', description: '物理ロールとルーム同期' },
  { id: 'board', label: 'ボード', description: '盤面、配置、得点演出' },
  { id: 'effects', label: 'エフェクト', description: '停止、配置、勝利演出' },
  { id: 'players', label: 'プレイヤー', description: 'VIP 情報、順位、通知' },
  { id: 'casino', label: 'カジノエントリー', description: '入場、着席、READY' },
  { id: 'bank', label: 'バンク', description: 'コインと金庫の取引演出' },
];

function selectedFromLocation(): PreviewId | null {
  const value = new URLSearchParams(location.search).get('preview');
  return value && Object.hasOwn(previews, value) ? value as PreviewId : null;
}

function App() {
  const selected = selectedFromLocation();
  if (selected) {
    const Preview = previews[selected];
    const label = options.find(option => option.id === selected)?.label ?? 'プレビュー';
    return <>
      <a className="preview-back" href="/" aria-label="デモ一覧に戻る">
        <span aria-hidden="true">←</span> デモ一覧
      </a>
      <Suspense fallback={<div className="preview-loading" role="status">デモを読み込んでいます…</div>}>
        <Preview key={selected} />
      </Suspense>
      <span className="preview-current" aria-live="polite">{label}</span>
    </>;
  }

  return <main className="preview-home">
    <header className="preview-brand"><span className="brand-mark" aria-hidden="true">◇</span><span>ATELIER NOIR</span></header>
    <section className="preview-intro">
      <p className="eyebrow">GAMBLER COMPONENTS</p>
      <h1>デモ一覧</h1>
      <p>見たい要素を選ぶと、単独のプレビューを開きます。</p>
    </section>
    <nav className="preview-grid" aria-label="デモを選択">
      {options.map((option, index) => <a className="preview-card" key={option.id}
        href={`/?preview=${option.id}`}>
        <span className="preview-card-number">0{index + 1}</span>
        <strong>{option.label}</strong>
        <span>{option.description}</span>
        <span className="preview-card-arrow" aria-hidden="true">↗</span>
      </a>)}
    </nav>
    <footer className="preview-footer">ローカルプレビュー · 6要素</footer>
  </main>;
}

const root = document.getElementById('root');
if (!root) throw new Error('プレビューの表示先が見つかりません。');
createRoot(root).render(<App />);
