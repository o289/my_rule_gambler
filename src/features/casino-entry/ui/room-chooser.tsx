import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { parseRoomId, ROOM_ID_MAX, ROOM_NAME_MAX } from '../../../shared/contracts/casino-entry';

export type RoomAction = 'create' | 'join';
export interface RoomProblem { action: RoomAction; message: string }

export function RoomChooser({ invitedRoom, pending, problem, blocked, submit }: {
  invitedRoom?: string;
  pending: RoomAction | null;
  problem: RoomProblem | null;
  blocked?: boolean;
  submit: (action: RoomAction, input: string) => void;
}) {
  const title = useRef<HTMLHeadingElement>(null);
  const joinInput = useRef<HTMLInputElement>(null);
  const createInput = useRef<HTMLInputElement>(null);
  const [action, setAction] = useState<RoomAction>(() => problem?.action ?? (parseRoomId(invitedRoom ?? '') ? 'join' : 'create'));
  const [name, setName] = useState('');
  const [roomId, setRoomId] = useState(invitedRoom?.slice(0, ROOM_ID_MAX) ?? '');

  useEffect(() => {
    if (!blocked) title.current?.focus({ preventScroll: true });
  }, [blocked]);
  useEffect(() => {
    if (problem && !blocked) (problem.action === 'create' ? createInput : joinInput).current?.focus({ preventScroll: true });
  }, [problem, blocked]);

  function send(event: FormEvent<HTMLFormElement>, action: RoomAction, value: string) {
    event.preventDefault();
    if (!pending && !blocked) submit(action, value);
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
        <form key="create" className="room-choice-form" id="create-room-form" onSubmit={event => send(event, 'create', name)} aria-busy={pending === 'create'}>
          <label htmlFor="room-name">ルーム名</label>
          <input id="room-name" ref={createInput} type="text" value={name} maxLength={ROOM_NAME_MAX}
            onChange={event => setName(event.currentTarget.value)} placeholder="ルーム名を入力" autoComplete="off"
            aria-invalid={problem?.action === 'create' || undefined} aria-describedby={problem?.action === 'create' ? 'room-error' : undefined}
            disabled={Boolean(pending)} />
          <button className="casino-action" id="create-room" type="submit" disabled={Boolean(pending)}>
            {pending === 'create' ? '作成中…' : '作成して入室'}
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
