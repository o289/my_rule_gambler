import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { parseRoomId, ROOM_ID_MAX } from '../../../shared/contracts/casino-entry';

export type RoomRequest = ['create'] | ['join', roomId: string];
export type RoomAction = RoomRequest[0];
export interface RoomProblem { action: RoomAction; message: string }

export function RoomChooser({ invitedRoom, pending, problem, blocked, submit }: {
  invitedRoom?: string;
  pending: RoomAction | null;
  problem: RoomProblem | null;
  blocked?: boolean;
  submit: (...request: RoomRequest) => void;
}) {
  const title = useRef<HTMLHeadingElement>(null);
  const joinInput = useRef<HTMLInputElement>(null);
  const createButton = useRef<HTMLButtonElement>(null);
  const [action, setAction] = useState<RoomAction>(() => problem?.action ?? (parseRoomId(invitedRoom ?? '') ? 'join' : 'create'));
  const [roomId, setRoomId] = useState(invitedRoom?.slice(0, ROOM_ID_MAX) ?? '');

  useEffect(() => {
    if (!blocked) title.current?.focus({ preventScroll: true });
  }, [blocked]);
  useEffect(() => {
    if (!problem || blocked) return;
    const control = problem.action === 'create' ? createButton.current : joinInput.current;
    control?.focus({ preventScroll: true });
  }, [problem, blocked]);

  function send(event: FormEvent<HTMLFormElement>, ...request: RoomRequest) {
    event.preventDefault();
    if (!pending && !blocked) submit(...request);
  }

  return <main className="vip-lobby room-chooser" id="room-chooser" inert={blocked}>
    <section className="vip-panel room-choice-panel" aria-labelledby="room-choice-title">
      <header className="room-choice-heading">
        <p>GAMBLER</p>
        <h1 id="room-choice-title" ref={title} tabIndex={-1}>ルームを選ぶ</h1>
      </header>
      <fieldset className="room-choice-mode" disabled={Boolean(pending)}>
        <legend className="room-choice-legend">入室方法</legend>
        <label><input type="radio" name="room-choice-mode" value="create" checked={action === 'create'} onChange={() => setAction('create')} /><span>ルーム作成</span></label>
        <label><input type="radio" name="room-choice-mode" value="join" checked={action === 'join'} onChange={() => setAction('join')} /><span>ルーム参加</span></label>
      </fieldset>
      {action === 'create' ?
        <form key="create" className="room-choice-form" id="create-room-form" onSubmit={event => send(event, 'create')} aria-busy={pending === 'create'}>
          <button className="casino-action" id="create-room" ref={createButton} type="submit" disabled={Boolean(pending)}
            aria-describedby={problem?.action === 'create' ? 'room-error' : undefined}>
            {pending === 'create' ? '作成中…' : '部屋を作成'}
          </button>
        </form> :
        <form key="join" className="room-choice-form" id="join-room-form" onSubmit={event => send(event, 'join', roomId)} aria-busy={pending === 'join'}>
          <label htmlFor="join-room-id">ルームID</label>
          <input id="join-room-id" ref={joinInput} type="text" value={roomId} maxLength={ROOM_ID_MAX}
            onChange={event => setRoomId(event.currentTarget.value)} placeholder="ルームIDを入力" autoComplete="off" autoCapitalize="off" spellCheck={false}
            aria-invalid={problem?.action === 'join' || undefined} aria-describedby={problem?.action === 'join' ? 'room-error' : undefined}
            disabled={Boolean(pending)} />
          <button className="casino-action" id="join-room" type="submit" disabled={Boolean(pending)}>
            {pending === 'join' ? '参加確認中…' : 'IDで参加'}
          </button>
        </form>}
      {problem?.action === action && <p className="room-choice-error" id="room-error" role="alert">{problem.message}</p>}
    </section>
  </main>;
}
