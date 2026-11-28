import { useId, useRef } from 'react';
import { DEFAULT_GAME_RULES, OFFICIAL_DICE_TOTAL } from '../../../shared/contracts/game-rules';
import { MAX_PLAYERS, MIN_PLAYERS } from '../../../shared/contracts/casino-entry';
import { DEFAULT_CONFIG } from '../../../shared/contracts/dice';
import './rulebook.css';

export function RulebookDialog({ disabled }: { disabled?: boolean }) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  return <>
    <button type="button" className="vip-quiet rulebook-trigger" ref={trigger} disabled={disabled}
      aria-haspopup="dialog" onClick={() => dialog.current?.showModal()}>遊び方・ルールブック</button>
    <dialog ref={dialog} className="vip-dialog rulebook-dialog" aria-labelledby={titleId}
      onClose={() => { if (!dialog.current?.open) trigger.current?.focus({ preventScroll: true }); }}>
      <div className="vip-shell">
        <header className="rulebook-header">
          <h2 id={titleId}>遊び方・ルールブック</h2>
          <form method="dialog">
            <button type="submit" className="vip-quiet">閉じる</button>
          </form>
        </header>
        <div className="vip-content rulebook-content" tabIndex={0} role="region" aria-label="Web版の遊び方">
          <h3>目的と準備</h3>
          <p>{MIN_PLAYERS}〜{MAX_PLAYERS}人で宝石のダイスをボードに置き、勝利点を目指します。各プレイヤーは80点で始めます。待機室で全員が READY を押すと対戦が始まり、ボードと手番順が決まります。</p>
          <p>既定の勝利点は{DEFAULT_GAME_RULES.victoryPoints}点です。初期ダイス配布の既定は公式方式で、{OFFICIAL_DICE_TOTAL}個を人数に応じて均等に配ります。部屋で適用される値は、待機室の「ルール設定」または対戦中の VIP PLAYERS の「適用ルール」で確認できます。</p>
          <h3>ダイスを振って置く</h3>
          <ol>
            <li>自分の手番で <strong>ROLL DICE</strong> を押します。手元に{DEFAULT_CONFIG.count}個以上あれば{DEFAULT_CONFIG.count}個、それより少なければ手元の分をすべて振ります。</li>
            <li>ダイスが止まったら <strong>CONFIRM</strong> を押します。確定した出目から宝石を選び、ボードで光るマスを押して置きます。</li>
            <li>各横列は左から順に埋めます。空きマスを飛ばさず、その列で左端の空きマスと同じ宝石を置きます。</li>
          </ol>
          <h3>振り直す・手番を終える</h3>
          <p>置ける出目があれば、少なくとも1個を置きます。最初の投擲や振り直しの結果に置ける出目がなければ、自動で次の手番へ進みます。</p>
          <p>1個以上置いて未配置の出目が残っているときは、<strong>REROLL</strong> で残りをすべて振り直すか、<strong>END TURN</strong> で手番を終えます。置いたダイスはボードに残り、手番を終えると未配置のダイスは手元に戻ります。</p>
          <h3>列の得点とボード更新</h3>
          <p>列の最後のマスを埋めた人が、その列の点数をまとめて精算します。たとえば +20点の列なら、途中のマスを誰が埋めたかにかかわらず、最後の1個を置いた人が20点を獲得します。マイナスの列では表示分を支払い、残高は0点まで下がります。</p>
          <p>勝利が決まる前にボードが埋まると、得点を持ち越してダイスを配り直し、新しいボードで次のラウンドを始めます。固定配布の対戦では、全員が手元のダイスを使い切った場合も次のラウンドに進みます。</p>
          <h3>勝利条件</h3>
          <p>列の精算後に誰かが部屋の勝利点に達すると、その時点で対戦が終了します。最高得点のプレイヤーが勝利し、最高点が同点なら同率優勝です。</p>
        </div>
      </div>
    </dialog>
  </>;
}
