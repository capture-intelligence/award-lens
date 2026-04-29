import type { DataCoverageTreeStyleConfig } from './types';

export const defaultStyleConfig: DataCoverageTreeStyleConfig = {
  nodeStrokeColor: '#FBE9D0',
  nodeStrokeWidth: 2.5,
  linkBaseWidthDesktop: 24,
  linkBaseWidthTablet: 20,
  linkBaseWidthMobile: 16,
  linkOverlayWidthDesktop: 16,
  linkOverlayWidthTablet: 12,
  linkOverlayWidthMobile: 10,
  linkBaseOpacity: 0.3,
  linkOverlayOpacity: 0.6,
  rootFontSize: 18,
  textColor: '#244855',
  textOutlineColor: '#FBE9D0',
  textOutlineWidthDesktop: '4px',
  textOutlineWidthMobile: '3px',
  indicatorColor: '#FBE9D0',
  animationDuration: 600,
  hoverDuration: 200,
  zoomMin: 0.5,
  zoomMax: 2,
};

export function mergeConfig<T>(defaults: T, override?: Partial<T>): T {
  if (!override) return defaults;
  return { ...defaults, ...override };
}
