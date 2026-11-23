import type { BankRun } from '../application/bank-player';
import hall from '../../../shared/assets/bank/vault-hall.webp';
import door from '../../../shared/assets/bank/vault-door.webp';
import receiptRing from '../../../shared/assets/effects/gold-ring.webp';

const SPOKES = [0, 72, 144, 216, 288];

function Wheel() {
  return (
    <span className="vault-wheel" aria-hidden="true">
      <i className="wheel-rim" />
      {SPOKES.map(angle => <i key={angle} className="wheel-spoke" style={{ rotate: `${angle}deg` }} />)}
      <i className="wheel-hub" />
    </span>
  );
}

function vaultState(run: BankRun | null) {
  if (!run?.playing) return '施錠中';
  if (run.reached.has('lock')) return '施錠中';
  if (run.reached.has('close')) return '閉鎖中';
  if (run.reached.has('change')) return 'お釣り送出中';
  if (run.reached.has('launch')) return run.transaction.type === 'deposit' ? 'コイン送出中' : 'コイン回収中';
  if (run.reached.has('open')) return '開放中';
  if (run.reached.has('unlock')) return '解錠中';
  if (run.reached.has('wake')) return '起動中';
  return run.transaction.type === 'deposit' ? '送出準備中' : '回収準備中';
}

export function Vault({ run, moving = false }: { run: BankRun | null; moving?: boolean }) {
  const open = moving || Boolean(run?.playing && run.reached.has('open') && !run.reached.has('close'));
  const unlocked = moving || Boolean(run?.playing && run.reached.has('unlock') && !run.reached.has('lock'));
  const energized = moving || Boolean(run?.playing && run.reached.has('wake') && !run.reached.has('lock'));

  const pulse = run?.transaction.type === 'deposit' || run?.reached.has('change') ? [...run.flights.values()].filter(flight => flight.direction === 'deposit').at(-1)?.coin : run?.lastReceipt;

  return (
    <>
      <div className="vault-camera" data-energized={energized} aria-hidden="true">
        <img className="vault-hall" src={hall} alt="" draggable={false} />
        <div className="vault-portal" data-open={open} data-unlocked={unlocked} data-instant={!run ? !moving : run.skipped}>
          <div className="vault-tunnel-light" />
          <div className="vault-rim-light" />
          <span id="vault-mouth" className="vault-mouth" data-vault-mouth="">
            {run?.playing && open && pulse && <span key={pulse.id} className="vault-receipt">
              <img className="receipt-wave" src={receiptRing} alt="" />
              <i className="receipt-core" />
            </span>}
          </span>
          <div className="vault-door-rig">
            <div className="door-slab">
              <i className="door-edge" />
              <div className="door-reverse" />
              <div className="door-front">
                <img className="door-texture" src={door} alt="" draggable={false} />
                <Wheel />
              </div>
            </div>
          </div>
        </div>
        <div className="vault-light-spill" data-open={open} />
      </div>
      <div className="vault-status">
        <span className="status-jewel" data-open={open} aria-hidden="true" />
        <span>金庫</span><strong>{moving ? '金貨移動中' : vaultState(run)}</strong>
      </div>
    </>
  );
}
