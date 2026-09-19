export interface Point { x: number; y: number }
export interface Snake {
  id: number; name: string; isSelf: boolean; alive: boolean;
  head: Point; renderHead: Point; heading: number; targetHeading: number;
  /** Client speed units per simulation frame, not pixels/second. */
  speed: number; normalSpeed: number; boostSpeed: number; boostRequested: boolean | null;
  /** Nominal radians/second from client turn parameters; absent in older recordings. */
  turnRate?: number | null;
  /** visualRadius is an estimate from the renderer, not a server collision radius. */
  scale: number; visualRadius: number; segmentCount: number; growth: number;
  score: number | null; color: string | null; skin: number | null; kills: number | null;
  /** Tail to neck. Head is separate. Dying points are retained with a flag. */
  body: (Point & { renderPosition: Point; dying: boolean })[];
}
export interface Food {
  id: number; position: Point; size: number; colorIndex: number;
  sector: Point; eaten: boolean; eatenBy: number | null;
}
export interface Prey {
  id: number; position: Point; renderPosition: Point; size: number;
  heading: number; targetHeading: number; speed: number; color: string | null;
  eaten: boolean; eatenBy: number | null;
}
export interface GameState {
  schemaVersion: 1; capturedAt: number; status: 'menu' | 'connecting' | 'playing' | 'dead' | 'disconnected';
  client: { protocolVersion: number; scriptUrl: string | null; connected: boolean; socketReadyState: number | null; lastMessageAt: number | null };
  coverage: { mode: 'client-loaded'; fullWorld: false; explanation: string; serverSectors: Point[]; foodSectors: Point[]; sectorsDescribeCompleteVisibility: false };
  arena: { center: Point; radius: number | null; renderedRadius: number | null; sectorSize: number; sectorsAlongEdge: number; bounded: boolean };
  camera: { position: Point; scale: number; viewportScale: number | null; viewport: { width: number; height: number }; followsSelf: boolean };
  self: Snake | null; snakes: Snake[]; food: Food[]; prey: Prey[];
  /** Anonymous global occupancy, row-major. No identity or exact body positions. */
  minimap: { width: number; height: number; cells: (0 | 1)[]; encoding: 'row-major-occupancy'; identifiesEntities: false } | null;
  leaderboard: { name: string; score: number; rank: number }[];
  stats: { rank: number | null; totalPlayers: number | null; bestRank: number | null };
}
export interface Action {
  /** World angle in radians: 0 = right, PI/2 = down; positive clockwise. */
  heading: number;
  /** Holding boost consumes length. Defaults to false. */
  boost?: boolean;
  /** Optional wall-clock deadline. Expired actions use fresh heading without boost. */
  expiresAt?: number;
  decision?: {
    provider: 'jev'; source: 'jev' | 'fallback'; reason?: string; requested: boolean;
    requestMs?: number; model?: string; confidence?: number; choice?: string;
    inputTokens?: number; outputTokens?: number; probabilities?: Record<string, number>;
  } | {
    provider: 'mcts'; source: 'mcts' | 'fallback'; reason?: string; choice: string;
    searchMs: number; iterations: number; nodes: number; maxDepth: number; horizonMs: number;
    root: { choice: string; visits: number; value: number; survivesFirstMove: boolean }[];
  };
}
export interface DecisionContext { episode: number; step: number; dtMs: number }
export interface Policy {
  name?: string;
  reset?(context: { episode: number }): void | Promise<void>;
  decide(state: GameState & { status: 'playing'; self: Snake }, context: DecisionContext): Action | Promise<Action>;
}
export interface PolicyContext { random(): number; seed: number; config: Record<string, unknown>; decisionTimeoutMs: number; tickMs: number }
export type PolicyFactory = (context: PolicyContext) => Policy | Promise<Policy>;
