'use strict';

// The formatting guide at /help/markdown. Each example shows its source, then renders it.
const EXAMPLES = [
  ['Headings', `## Section heading
### Subsection
#### Smaller heading`, 'Level 2 to 4 headings appear in the floating table of contents once an article has three or more.'],
  ['Text styles', `**Bold**, *italic*, ~~struck out~~, ==highlighted== and \`inline code\`.`],
  ['Links', `[Dell iDRAC docs](https://www.dell.com/support)
https://example.com links itself.
Link to another article by title: [[Replacing a PSU]]
Or give it different text: [[replacing-a-psu|the PSU runbook]]`, 'Wiki links to articles that don’t exist yet are shown dashed. Clicking one starts that article.'],
  ['Photos', `![Rear of the rack](/static/img/sample-photo.svg "Row 4, rear view")

![Smaller version|240](/static/img/sample-photo.svg)`, 'Paste, drag or use the photo button in the editor and the Markdown is written for you. Add |width after the description to size an image. A title in quotes becomes a caption.'],
  ['Lists', `- Unplug the power cables
- Pull the PSU release lever
  - Left PSU first
  - Wait for the fans to settle
- Seat the new unit

1. Open a ticket
2. Swap the part
3. Close the ticket`],
  ['Checklists', `- [x] Label the cables
- [ ] Update the asset record`],
  ['Code blocks', "```bash\nipmitool -I lanplus -H 10.0.4.21 -U admin sel list\n```", 'Name the language after the opening backticks. Every code block gets a copy button.'],
  ['Callouts', `> [!WARNING] Hot-swap only
> Never pull both PSUs on a running node.

> [!TIP]
> Photograph the cabling before you start.`, 'Types: NOTE, TIP, INFO, IMPORTANT, WARNING, CAUTION, DANGER.'],
  ['Quotes', `> The best runbook is the one someone actually wrote down.`],
  ['Tables', `| Rack | Rows | Power |
|:-----|-----:|:-----:|
| A04  | 42   | 2× 30A |
| A05  | 42   | 2× 30A |`, 'Colons in the separator row set left, right or center alignment.'],
  ['Dividers and line breaks', `First line\\
Second line (a backslash or two trailing spaces force a break)

---

After the divider`],
];

const source = EXAMPLES.map(([title, src, note]) =>
  `## ${title}\n\n${note ? note + '\n\n' : ''}\`\`\`\`markdown\n${src}\n\`\`\`\`\n\n${src}\n`).join('\n---\n\n') +
  `\n---\n\n## Raw HTML\n\nHTML tags are shown as text rather than run, so pasted snippets are always safe to keep in an article.\n`;

module.exports = { source };
