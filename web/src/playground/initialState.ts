import type { Action } from './catalog';
import { numberParam } from '../deformation/src/demo/runtime';

/** Build every mount from URL/catalog defaults, never from retained controls. */
export function initialViewerState(params: URLSearchParams, actions: readonly Action[]) {
  const requested = params.get('mode') === 'impact' ? 'impact' : 'bend';
  const mode = actions.includes(requested) ? requested : actions[0];
  const strike = mode === 'impact' && params.get('strike') === '1';
  const strength = Math.min(1, Math.max(0, numberParam(params, 'bend', 0)));
  return {
    mode, strike,
    strength: strike && strength < 0.5 ? 0.85 : strength,
    direction: numberParam(params, 'dir', 25),
    mesh: params.get('mesh') === '1',
    splats: params.get('splats') !== '0',
    proxy: params.get('proxy') !== '0',
    relighting: true,
  };
}
