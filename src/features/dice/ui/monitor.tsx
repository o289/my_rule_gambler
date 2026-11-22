import type { ConnectionView } from './connection';
import type { RollConfig } from '../../../shared/contracts/dice';

interface Props {
  info: ConnectionView;
  fps: number | null;
  own: boolean;
  expanded: boolean;
  expand(value: boolean): void;
  configure(config: RollConfig): void;
}

const display = (value: number | null | undefined, places = 1) => value == null ? '—' : value.toFixed(places);

export function PerformanceMonitor({ info, fps, own, expanded, expand, configure }: Props) {
  if (!info.dev || !info.game) return null;
  const { game, metrics } = info;
  const canEdit = own && !info.pending && !(game.phase === 'rolling' || game.phase === 'confirm');
  const active = info.roll?.config;
  return (
    <div className="perf-monitor">
      <button type="button" className="quiet" aria-expanded={expanded} onClick={() => expand(!expanded)}>
        {expanded ? '性能モニターを閉じる' : '性能モニター'}
      </button>
      {expanded && <div className="perf-panel">
        <div className="perf-config">
          <label>次の演算
            <select id="physics-hz" value={game.config.hz} disabled={!canEdit} onChange={event => configure({
              ...game.config, hz: event.currentTarget.value === '240' ? 240 : 120,
            })}>
              <option value="120">120 Hz</option><option value="240">240 Hz</option>
            </select>
          </label>
          <label>次の新規ロール
            <select id="dice-count" value={game.config.count} disabled={!canEdit} onChange={event => configure({
              ...game.config, count: Number(event.currentTarget.value),
            })}>
              {[1, 2, 3, 4, 5].map(count => <option key={count} value={count}>{count} 個</option>)}
            </select>
          </label>
        </div>
        <dl>
          <div><dt>実行設定</dt><dd>{active ? `${active.hz} Hz / ${active.count} 個` : '—'}</dd></div>
          <div><dt>物理ステップ/秒</dt><dd data-metric="steps">{display(metrics?.stepsPerSecond)}</dd></div>
          <div><dt>送信フレーム/秒</dt><dd data-metric="send">{display(metrics?.sentPerSecond)}</dd></div>
          <div><dt>ステップ 平均 / 最大 (ms)</dt><dd>{display(metrics?.meanStepMs, 3)} / {display(metrics?.peakStepMs, 3)}</dd></div>
          <div><dt>サーバー CPU (%)</dt><dd>{display(metrics?.cpuPercent)}</dd></div>
          <div><dt>描画 FPS</dt><dd>{display(fps)}</dd></div>
          <div><dt>停止まで (秒)</dt><dd>{display(metrics?.stoppedMs == null ? null : metrics.stoppedMs / 1000, 2)}</dd></div>
        </dl>
      </div>}
    </div>
  );
}
