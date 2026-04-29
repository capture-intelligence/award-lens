/**
 * Recursive hierarchy node fed to <DataCoverageTree>. Ported from the
 * deviz prototype, with two minor extensions for our use case:
 *   - `payload` carries an arbitrary callsite-defined object through to the
 *     leaf-click callback (we use it to open AwardDetail with the raw row).
 *   - `htmlDescription` lets a node render rich tooltip content when the
 *     plain string fields are insufficient.
 */
export interface DataElement {
  title: string;
  availability?: 'both' | 'restricted' | 'public';
  category?: string;
  description?: string;
  details?: string;
  /** Optional rich-HTML override for the tooltip (rendered above details). */
  htmlDescription?: string;
  /** Arbitrary data carried to onLeafClick. */
  payload?: unknown;
  children?: DataElement[];
}

export interface AvailabilityColorMap {
  root?: string;
  both?: string;
  restricted?: string;
  public?: string;
  category?: string;
}

export interface DataCoverageTreeStyleConfig {
  nodeStrokeColor: string;
  nodeStrokeWidth: number;
  linkBaseWidthDesktop: number;
  linkBaseWidthTablet: number;
  linkBaseWidthMobile: number;
  linkOverlayWidthDesktop: number;
  linkOverlayWidthTablet: number;
  linkOverlayWidthMobile: number;
  linkBaseOpacity: number;
  linkOverlayOpacity: number;
  rootFontSize: number;
  textColor: string;
  textOutlineColor: string;
  textOutlineWidthDesktop: string;
  textOutlineWidthMobile: string;
  indicatorColor: string;
  animationDuration: number;
  hoverDuration: number;
  zoomMin: number;
  zoomMax: number;
}

export interface DataCoverageTreeProps {
  data: DataElement;
  width?: number;
  height?: number;
  availabilityColors?: AvailabilityColorMap;
  className?: string;
  styleConfig?: Partial<DataCoverageTreeStyleConfig>;
  /** Fired when a leaf node is clicked. Inner-node clicks expand/collapse. */
  onLeafClick?: (node: DataElement) => void;
}
