import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CueAudio } from '../../shared/audio/cue-audio';

class SuspendedAudio {
  state: AudioContextState = 'suspended';
  readonly currentTime = 2.75;
  readonly attempts: { resolve(): void; reject(): void }[] = [];

  resume() {
    return new Promise<void>((resolve, reject) => {
      this.attempts.push({ resolve, reject });
    });
  }

  resumeSuccessfully(index: number) {
    const attempt = this.attempts[index];
    assert.ok(attempt);
    this.state = 'running';
    attempt.resolve();
  }
}

test('音声の再開待ちでも最初の効果音が残り、操作を繰り返しても同じ再開処理を使う', async () => {
  const context = new SuspendedAudio();
  const audio = new CueAudio(() => context, () => 0);
  const played: number[] = [];

  audio.play(time => played.push(time));
  assert.equal(context.attempts.length, 0);
  audio.unlock();
  audio.unlock();
  audio.play(time => played.push(time));
  assert.equal(context.attempts.length, 1);
  assert.equal(played.length, 0);

  context.resumeSuccessfully(0);
  await Promise.resolve();
  assert.deepEqual(played, [context.currentTime]);
  audio.play(time => played.push(time));
  assert.deepEqual(played, [context.currentTime, context.currentTime]);
});

test('音声を止めると、差し替え前の演出も含めて再開待ちの効果音を取り消す', async () => {
  const context = new SuspendedAudio();
  const audio = new CueAudio(() => context, () => 0);
  const heard: string[] = [];

  audio.unlock();
  audio.play(() => heard.push('cut'));
  audio.cancel();
  audio.play(() => heard.push('replacement'));
  context.resumeSuccessfully(0);
  await Promise.resolve();
  assert.deepEqual(heard, ['replacement']);
});

test('古い効果音を破棄し、音声の再開が失敗または保留になっても再試行できる', async () => {
  const context = new SuspendedAudio();
  let now = 0;
  const audio = new CueAudio(() => context, () => now);
  const heard: string[] = [];

  audio.unlock();
  audio.play(() => heard.push('stale'));
  now = 1000;
  audio.unlock();
  const rejected = context.attempts[1];
  assert.ok(rejected);
  rejected.reject();
  await Promise.resolve();
  assert.equal(context.attempts.length, 2);
  assert.equal(heard.length, 0);

  now = 1001;
  audio.unlock();
  audio.play(() => heard.push('new'));
  context.resumeSuccessfully(0);
  await Promise.resolve();
  assert.equal(heard.length, 0, 'an obsolete resume promise cannot flush new cues');
  context.resumeSuccessfully(2);
  await Promise.resolve();
  assert.deepEqual(heard, ['new']);
});

test('音声の初期化が使えない場合や失敗した場合も呼び出し元の処理は続く', () => {
  for (const initialize of [() => null, () => { throw new Error('Audio unavailable'); }]) {
    const audio = new CueAudio(initialize);
    assert.doesNotThrow(audio.unlock);
    let played = false;
    audio.play(() => { played = true; });
    assert.equal(played, false);
  }
});
