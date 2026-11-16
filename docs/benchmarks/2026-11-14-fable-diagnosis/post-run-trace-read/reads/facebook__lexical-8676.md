# facebook__lexical-8676
Passes: X 1 of 2, Y 0 of 2
Fault named in the instruction: no (the issue describes playground steps; all tries changed the decorator branch of RangeSelection.deleteCharacter in LexicalSelection.ts and ListItemNode.collapseAtStart)
- X-a2 FAIL: right place but incomplete or wrong fix. It let the list item collapse before the decorator branch, as the pass did, but also changed the empty first item case so it becomes a paragraph instead of being removed with the decorator selected, and changed collapseAtStart caret and nesting behaviour.
- Y-a1 FAIL: right place but incomplete or wrong fix. Same core change, and it also turned an empty first item into a paragraph and moved the caret logic in collapseAtStart for multi-item lists.
- Y-a2 FAIL: right place but incomplete or wrong fix. Same core change; its own table shows the empty first item now becomes an empty paragraph rather than being removed with the decorator selected, plus the same collapseAtStart caret change.
Passing tries did differently: X-a1 changed only the non-empty case and deliberately kept the existing empty-item behaviour (item removed, decorator selected), offering the paragraph variant as a decision instead; its extra list fix was for nested sole items. That empty-item choice is the visible difference from all three failures, though the hidden test content is not shown.
Rating: NONE, favours neither. The deciding choice about the empty item split within X as well as against Y, so it looks like a per-try judgement call rather than an agent trait.
