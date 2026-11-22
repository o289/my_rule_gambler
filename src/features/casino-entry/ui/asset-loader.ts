export interface AssetTask {
  id: string;
  load: () => Promise<unknown>;
}

export interface AssetProgress {
  loaded: number;
  total: number;
}

export function createAssetLoader(tasks: readonly AssetTask[]) {
  const loaded = new Set<string>();
  let running: Promise<readonly string[]> | undefined;
  const getProgress = (): AssetProgress => ({ loaded: loaded.size, total: tasks.length });

  function run(progress: (value: AssetProgress) => void) {
    if (running) return running;
    progress(getProgress());
    const pending = tasks.filter(task => !loaded.has(task.id));
    running = Promise.all(pending.map(async task => {
      try {
        await task.load();
      } catch {
        return task.id;
      }
      loaded.add(task.id);
      progress(getProgress());
      return null;
    })).then(results => results.filter((id): id is string => id !== null)).finally(() => { running = undefined; });
    return running;
  }

  return { run, getProgress };
}

const images = new Map<string, Promise<HTMLImageElement>>();

export function releaseDecodedImages() { images.clear(); }

export function decodeImage(url: string) {
  const previous = images.get(url);
  if (previous) return previous;
  const task = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const timer = window.setTimeout(() => {
      fail();
      image.removeAttribute('src');
    }, 12000);
    function fail() {
      window.clearTimeout(timer);
      reject(new Error('画像を読み込めませんでした。'));
    }
    image.onerror = fail;
    image.onload = () => {
      const ready = image.decode ? image.decode() : Promise.resolve();
      void ready.then(() => {
        window.clearTimeout(timer);
        resolve(image);
      }, fail);
    };
    image.src = url;
  }).catch(error => {
    images.delete(url);
    throw error;
  });
  images.set(url, task);
  return task;
}
