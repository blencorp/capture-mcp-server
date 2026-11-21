// Expressive Code's client script gives a code block that scrolls sideways tabindex="0" and
// role="region" but no name. Two such regions on a page are then indistinguishable landmarks
// (axe: landmark-unique), and an unnamed region has no accessible name (WCAG 4.1.2). This plugin
// names every block's <pre> when it is rendered, so whichever blocks scroll already have one.
//
// A component names its block with a `label` prop on Code (Example.astro uses the file name). A
// fenced block uses its title, or its language and its position in the page. The position counts the blocks of one page (the Code component counts per page request, the
// Markdown renderer per document), so it is unique within a page. A block that has neither
// (a Code component with no label) gets only the language, so give those a label.

const findPre = (node) => {
  if (node.type === 'element' && node.tagName === 'pre') return node;
  for (const child of node.children ?? []) {
    const found = findPre(child);
    if (found) return found;
  }
};

const nameOf = ({ props, language, parentDocument }) => {
  if (typeof props.label === 'string' && props.label.trim()) return props.label.trim();
  if (props.title) return `Code: ${props.title}`;
  const position = parentDocument?.positionInDocument;
  const kind = `${language || 'text'} code`;
  return position ? `${kind}, block ${position.groupIndex + 1}` : kind;
};

export function pluginCodeNames() {
  return {
    name: 'Accessible names for code blocks',
    hooks: {
      postprocessRenderedBlock: ({ codeBlock, renderData }) => {
        const pre = findPre(renderData.blockAst);
        if (!pre) return;
        pre.properties = { ...pre.properties, ariaLabel: nameOf(codeBlock) };
      },
    },
  };
}
