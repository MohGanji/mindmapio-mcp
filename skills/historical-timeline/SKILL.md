---
name: historical-timeline
description: >
  Build a historical-timeline mindmap with mindmap.io for any topic ("the
  history of X up to Y"): one root with a legend, a main lane of breakthroughs
  in one colour, side branches that merge back through tag links, rose dead
  ends, and story notes under every node. Use when the person asks for a
  history, a timeline, an origin story or "how we got from A to B" as a map.
---

# Historical timeline maps

A timeline map tells a story you can read at a glance and question node by
node. The main lane is the line of progress. Side branches are the other
threads that grew apart from it and came back. Dead ends are the attempts that
didn't stick. Every node is a short story card with its date on it.

This skill covers the format. The `mindmapio` skill (or the MCP tools) covers
the calls; `map-shaping` covers how context flows through a map.

## The shape

### One root

The root holds the whole map's frame, and every node inherits it:

- the title as a `# heading`
- one italic line with the scope: `*A story history of AI · 1712 → today*`
- one or two sentences on what the threads are and how they meet
- a collapsible "How to read this map" block with:
  - the colour legend, one line per colour
  - the tag note: `@Name` in a node means it builds on that node
  - this line, word for word: **For follow-up questions:** answer as of each
    node's date, and flag anything that was invented later.

The last line is what lets a person ask "why didn't they try X?" under an 1824
node and get an answer from 1824, not from today.

### The main lane

One chain, one colour (`mint` in the worked example). Each child is the
breakthrough that came after its parent *because of* it, so reading straight
down the chain reads as cause and effect. Keep it to the spine: the ten to
twenty steps a person would name if they told the story in five minutes.

### Side branches

Each side branch is a thread with its own colour. It starts where it grew from:

- from the root, when it is a separate origin (logic, brains)
- from the main-lane node it split off from (Maxwell's demon grows out of
  entropy)

A side branch merges back when its time comes. The main-lane node where its
idea joins carries a **tag** to the branch's last node, and says so in a
sentence: "The demon branch merges here". After its merge, a branch usually
just stops. A branch that ends in a tag already reads as merged, so it needs no
closing node.

### Dead ends

Each breakthrough can fork into attempts that didn't stick. A dead end is a
leaf under the node it was competing with or tried to replace:

- coloured `rose`
- titled `# ✗ …`
- one or two lines on what it was and why it failed

`# ✗ Caloric` · *1780s–1840s · didn't stick* · "Heat as an invisible fluid
that flows from hot to cold. Carnot used it, then Joule's experiments buried
it."

Dead ends are what make the main lane mean something: they show the choices
the winners beat.

### Personal nodes (optional)

When the person's own projects connect to the history, add them where they
connect, in a colour no lane uses (`clay` in the worked example), with the
title starting `★`. Mention them in the legend.

## Node text

Every node is a `data` node. A timeline is content to read, not questions to
run, and a `data` node keeps its text exactly as written. Every node's text
follows one template:

```markdown
# Title
*Year · place or people · status*

One-line summary.

<details><summary>Story</summary>

Two to five sentences: the problem people had, what was tried, what changed.

</details>
```

- **Title**: the idea or the event, short enough to read zoomed out.
- **Date line**: the year or range first, then where or who, then a status if
  the map tracks one (`Episode 3 ✅`, `in progress ⏸`, `didn't stick`).
- **Summary**: one line that would make sense on its own.
- **Story**: a small narrative, concrete and in plain words. Short nodes
  (dead ends, small steps) can stop after the summary.

Dates and places live in the markdown, under the heading. They need no field of
their own.

## Tags: how branches merge

A tag is a link in a node's text to another node in the same map:

```markdown
Szilard shrinks [@Maxwell's demon](#node-a1) to a single molecule.
```

The node holding the link builds on the node it links to. The link's target is
the other node's id (`#node-a1`); the label is what reads in the text. The
canvas draws a faint dashed line between the two, and when the tagging node
runs a prompt, the tagged node's content goes into the model's context.

Three ways to use them:

- **Merges.** The main-lane node where a side branch joins tags the branch's
  last node.
- **Builds-on links** between nodes in different lanes: "a formula shaped like
  [@Boltzmann's](#node-m6)".
- **Personal links.** A ★ node tags the historical node it grew from.

Write a tag as the `[@Label](#node-id)` link. A plain `@Name` with no link
stays plain text.

## Building it

Build the whole map in one `import_map` call. Mint short, readable ids
yourself, so you can write every tag before anything exists:

| Lane | Ids |
| --- | --- |
| main lane | `m1`, `m2`, … |
| side branch | one letter per branch: `l1` (logic), `b1` (brains), `r1` (reward) |
| dead end | `x1`, `x2`, … |
| personal | `p1`, … |

Each node in the tree carries `id`, `parentId`, `children`, `nodeType: "data"`,
`color` and its text as `messages` (one user message). Then:

1. **Check dates and attributions.** Before publishing, read every date line
   and every name against what you know, and fix or soften anything you are
   unsure of ("reportedly", a range instead of a year). Check that each tag
   points at the node you meant, and that each merge node's sentence names the
   branch it merges.
2. **Set the layout to `tree`** (`set_map_layout`, or `PUT
   /api/mindmaps/{mapId}/layout`). It reads left to right, like time.
3. **Publish** (`publish_map`, or `POST /api/mindmaps/{mapId}/publish`) and
   give the person the link.

## Worked example: "From Steam to Minds"

The canonical example is a story history of AI, public at
<https://mindmap.io/app/Nj8XEUmOwb2mQb5r>. Its lanes:

| Colour | Lane |
| --- | --- |
| `mint` | main lane: heat → information → language models |
| `lavender` | logic and computation (starts at the root) |
| `pink` | brains and neural networks (starts at the root) |
| `sky` | learning from reward |
| `amber` | the demon puzzle · `sage` life as information |
| `rose` | ✗ tried, didn't stick |
| `clay` | ★ the person's own work |

An excerpt of the tree, with each node's text below:

```text
root
├── m1  Newcomen's engine (mint)
│   ├── x1  ✗ Savery's steam pump (rose)
│   └── m2  Watt's separate condenser (mint)
│       └── … m5  Clausius: entropy (mint)
│               ├── a1  Maxwell's demon (amber)
│               └── m6  Boltzmann: counting the invisible (mint)
│                   └── m7  Szilard's bit of heat (mint)   tags a1: the demon branch merges
│                       └── m8  A theory of communication (mint)   tags m6, l16, l5
└── l1  Leibniz's calculating dream (lavender)
    └── l5  Boole's laws of thought (lavender)
        └── l16 Shannon's switches (lavender)   tags l5; the branch stops, m8 merges it
```

**root**

```markdown
# From Steam to Minds
*A story history of AI · 1712 → today*

One root, three roots of the story: engines (heat and entropy), logic (calculation) and brains (learning). Side branches grow apart, then merge back into the main lane when their time comes.

<details><summary>How to read this map</summary>

- **Mint**: main lane, from heat to information to language models
- **Lavender**: logic and computation
- **Pink**: brains and neural networks
- **Sky**: learning from reward
- **Amber**: the demon puzzle · **Sage**: life as information
- **Rose ✗**: tried, didn't stick
- **Clay ★**: Mo's own work
- `@Name` in a node = it builds on that node

**For follow-up questions:** answer as of each node's date, and flag anything that was invented later.

</details>
```

**m1** (main lane, `mint`, child of the root)

```markdown
# Newcomen's engine
*1712 · England · Episode 1 ✅*

Steam that pumps water out of mines.

<details><summary>Story</summary>

Coal mines were flooding. Newcomen filled a cylinder with steam, then sprayed in cold water: the steam condensed, a vacuum formed, and air pressure pushed the piston down to work the pump. Wasteful, because the cylinder was reheated and cooled every stroke, but it worked.

</details>
```

**x1** (dead end, `rose`, child of m1)

```markdown
# ✗ Savery's steam pump
*1698 · didn't stick*

Steam pressure pushed water up directly. High-pressure boilers burst, and it could only lift water a short way.
```

**a1** (side branch, `amber`, child of m5 where it grew out of entropy)

```markdown
# Maxwell's demon
*1867 · Scotland · Episode 5 ✅*

A tiny imp seems to break the second law just by knowing things.

<details><summary>Story</summary>

Maxwell imagined a doorkeeper between two boxes of gas who lets only fast molecules through one way. Heat flows from cold to hot with no work done. A thought experiment, not a machine, it hinted that information is physical. The puzzle stays open for 60 years.

</details>
```

**m7** (main lane, merges the demon branch)

```markdown
# Szilard's bit of heat
*1929 · Berlin · Episode 11*

One yes-or-no answer has a price in heat.

<details><summary>Story</summary>

Szilard shrinks [@Maxwell's demon](#node-a1) to a single molecule and asks what knowing which side it's on costs. The demon branch merges here: information becomes a physical quantity.

</details>
```

**l16** (side branch, `lavender`, its last node before the merge)

```markdown
# Shannon's switches
*1937 · MIT · Episode 12*

A master's thesis shows relay circuits are [@Boole's](#node-l5) algebra in hardware. Logic becomes electricity, and this branch flows into Shannon 1948.
```

**m8** (main lane, merges the logic branch)

```markdown
# A mathematical theory of communication
*1948 · Shannon · Episode 13*

The bit, and entropy as surprise.

<details><summary>Story</summary>

Shannon measures information as reduced uncertainty, with a formula shaped like [@Boltzmann's](#node-m6). Von Neumann reportedly told him to call it entropy. The logic branch merges here through [@Shannon's switches](#node-l16) and [@Boole](#node-l5).

</details>
```

In `import_map`, m7 looks like this:

```json
"m7": {
  "id": "m7", "parentId": "m6", "children": ["a2", "m8"],
  "nodeType": "data", "color": "mint",
  "messages": [{ "role": "user", "parts": [{ "type": "text",
    "text": "# Szilard's bit of heat\n*1929 · Berlin · Episode 11*\n\nOne yes-or-no answer has a price in heat.\n\n<details><summary>Story</summary>\n\nSzilard shrinks [@Maxwell's demon](#node-a1) to a single molecule and asks what knowing which side it's on costs. The demon branch merges here: information becomes a physical quantity.\n\n</details>" }] }]
}
```

## Finishing

Hand back the published link with one line on the lanes and how many nodes
are on the map. The person can then open any node and ask a follow-up, and the
root's last line keeps the answer in that node's time.
