# Skills used for the briefing

When Claude Code writes the pre-open and post-close briefing, the prompt in
`pipeline/briefing.py` includes these published Agent Skills as the analysis
method. The files are unmodified copies; their own licenses apply.

| Skill | What it is used for | Source | Commit | License |
| --- | --- | --- | --- | --- |
| `morning-note` | Structure and tone of the briefing: lead with the top call, overnight developments, key events, ideas with their risk | [anthropics/financial-services](https://github.com/anthropics/financial-services) (`plugins/vertical-plugins/equity-research`) | `6056506` | Apache-2.0 |
| `thesis-tracker` | Reviewing each holding: what changed, whether it strengthens or weakens the reason to hold, the action and conviction | same | `6056506` | Apache-2.0 |
| `market-news-analyst` | Ranking news by actual market impact, source credibility and common attribution pitfalls (the impact-assessment, principles and pitfalls sections) | [tradermonty/claude-trading-skills](https://github.com/tradermonty/claude-trading-skills) | `163ceb4` | MIT |

These skills were written for professional analysts and mostly for US markets.
The prompt tells Claude to keep the method but adapt it: the reader is a
beginner holding Taiwan stocks for the medium term, there are no price targets
or ratings, no short selling, and the output stays in the app's JSON format in
Traditional Chinese.

To update a skill, replace its `SKILL.md` with the newer upstream file, read
it, and change the commit in this table.
