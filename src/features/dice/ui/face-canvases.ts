import frameImage from '../../../shared/assets/gems/frame.webp';
import { GEMS } from '../../board/model/gems';
import { FACES } from '../model/geometry';

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('ダイスの画像を読み込めませんでした。'));
    image.src = url;
  });
}

let materialsSource: Promise<HTMLCanvasElement[]> | undefined;

export function preloadDice() {
  materialsSource ??= Promise.all([loadImage(frameImage), ...FACES.map(face => loadImage(GEMS[face.gem].image))])
    .then(([border, ...gems]) => {
      if (!border) throw new Error('ダイス枠が見つかりません。');
      return gems.map(gem => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 512;
        const brush = canvas.getContext('2d');
        if (!brush) throw new Error('画像処理を初期化できません。');
        brush.drawImage(border, 0, 0, 512, 512);
        brush.shadowColor = '#080502';
        brush.shadowBlur = 20;
        brush.shadowOffsetY = 8;
        brush.drawImage(gem, 71, 71, 370, 370);
        return canvas;
      });
    }).catch(error => {
      materialsSource = undefined;
      throw error;
    });
  return materialsSource;
}
