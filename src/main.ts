import './ui/style.css';
import { Game } from './game';

function fail(msg: string) {
  const el = document.getElementById('ui');
  if (el) el.innerHTML = `<div class="loading" style="flex-direction:column;padding:24px;text-align:center">${msg}</div>`;
}

const canvas = document.getElementById('game') as HTMLCanvasElement;
try {
  const test = document.createElement('canvas');
  if (!test.getContext('webgl2') && !test.getContext('webgl')) throw new Error('no webgl');
  const game = new Game(canvas);
  (window as any).__game = game;
  game.boot();
} catch (e) {
  console.error(e);
  fail('Mistwood needs WebGL to run.<br><small>Please try a recent version of Chrome, Firefox, Edge or Safari.</small>');
}
