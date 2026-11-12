import { memo } from 'react';
import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps } from '@xyflow/react';
import type { ServiceMapEdge } from '@/types';
import { bezierPath, bezierPoint, edgeBezier, errorKnown, fmtPct, fmtRps, hasTraffic, labelT, protoClass, CLASS_VAR } from './serviceMapUtil';

export interface FlowData extends Record<string, unknown> {
  edge: ServiceMapEdge;
  rpsLabel: string;
  dim: boolean;
  highlight: boolean;
  showLabel: boolean;
  width: number;
  /** Dense map: error tints recede until a path is selected. */
  dense: boolean;
  /** Offset among parallel links between the same two nodes. */
  lane: number;
}

export type FlowEdgeType = Edge<FlowData, 'flow'>;

// A curved, glowing link. Width follows log(rps); config-only links (no
// observed traffic) are thin and dashed; error-heavy links tint red; the
// selected path lights up in the class colour with its rate on a label.
function FlowEdgeImpl({ id, sourceX, sourceY, targetX, targetY, data }: EdgeProps<FlowEdgeType>) {
  if (!data) return null;
  const { edge, dim, highlight, showLabel, width, rpsLabel, dense, lane } = data;
  const b = edgeBezier(sourceX, sourceY, targetX, targetY, lane);
  const path = bezierPath(b);
  const traffic = hasTraffic(edge.stats);
  const errHeavy = errorKnown(edge.stats) && edge.stats.errorRate >= 0.05;
  const cls = protoClass(edge.protocol);
  const tone = errHeavy || edge.issue ? 'var(--sm-crit)' : `var(${CLASS_VAR[cls]})`;
  const stroke = highlight ? tone : errHeavy ? `color-mix(in oklab, var(--sm-crit) ${dense ? 28 : 55}%, transparent)` : dim ? 'var(--sm-edge-dim)' : 'var(--sm-edge)';
  // Arrowhead at the target, along the curve's last tangent.
  const tail = edge.flow === 'consume' ? b.p0 : b.p3;
  const prev = edge.flow === 'consume' ? bezierPoint(b, 0.06) : bezierPoint(b, 0.94);
  const ang = Math.atan2(tail.y - prev.y, tail.x - prev.x);
  const ah = 7 + width * 0.6;
  const arrow = `M${tail.x},${tail.y} L${tail.x - ah * Math.cos(ang - 0.4)},${tail.y - ah * Math.sin(ang - 0.4)} L${tail.x - ah * Math.cos(ang + 0.4)},${tail.y - ah * Math.sin(ang + 0.4)} Z`;
  const mid = bezierPoint(b, labelT(lane));
  // A link that goes up swings out beside the cards: hang its label on the
  // outer side of the curve so the cards do not cover it.
  const up = targetY < sourceY + 24;
  const anchor = !up ? 'translate(-50%, -50%)' : targetX >= sourceX ? 'translate(8px, -50%)' : 'translate(calc(-100% - 8px), -50%)';
  return (
    <>
      {highlight && !dense && <path d={path} fill="none" stroke={tone} strokeOpacity={0.25} strokeWidth={width + 7} style={{ filter: 'blur(4px)' }} />}
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={18}
        style={{
          stroke,
          strokeWidth: highlight ? width + 0.6 : width,
          strokeDasharray: traffic ? undefined : '5 6',
          opacity: dim ? 0.5 : 1,
          transition: dense ? undefined : 'stroke 0.25s, opacity 0.25s',
        }}
      />
      <path d={arrow} fill={stroke} opacity={dim ? 0.5 : 0.9} />
      {showLabel && (edge.stats.hasRed || edge.issue) && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none absolute whitespace-nowrap rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums shadow-sm"
            style={{
              transform: `translate(${mid.x}px, ${mid.y}px) ${anchor}`,
              background: 'var(--sm-card)',
              border: `1px solid ${highlight ? tone : 'var(--sm-card-border)'}`,
              color: 'var(--sm-text)',
              backdropFilter: dense ? undefined : 'blur(6px)',
            }}
          >
            {edge.stats.hasRed && `${fmtRps(edge.stats.rps)} ${rpsLabel}`}
            {(edge.calls ?? 0) > 1 && <span style={{ color: 'var(--sm-text-2)' }}> · ×{edge.calls}</span>}
            {errorKnown(edge.stats) && edge.stats.errorRate >= 0.001 && (
              <span style={{ color: edge.stats.errorRate >= 0.05 ? 'var(--sm-crit)' : 'var(--sm-warn)' }}> · {fmtPct(edge.stats.errorRate)}</span>
            )}
            {edge.issue && <span style={{ color: 'var(--sm-crit)' }}> ⚠ {edge.issue}</span>}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const FlowEdge = memo(FlowEdgeImpl);
