export interface AgentIcon {
  /** Stable lowercase id, such as `claude-code` or `deepseek`. */
  id: string;
  /** The product or maker name to show. */
  name: string;
  maker: string;
  /** True when the entry is an Agent product, whose name replaces the name an Agent gave. */
  agent: boolean;
  /** True for a one-colour mark, to be drawn in the theme's ink rather than as it is. */
  ink: boolean;
  /** Lowercase words, joined by hyphens, that identify the entry within a name. */
  aliases: readonly string[];
  /** The icon as a data: URL (SVG or PNG). */
  src: string;
}
