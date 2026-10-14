# Chatly Arcade

Open-source single-player HTML5 games bundled with Chatly. Each game runs in a sandboxed iframe served from this
site (no third-party scripts, no trackers — analytics snippets were removed) and reports its final score to the
app through `bridge.js`, which also adds touch controls and phone-sized layouts. Sources are unmodified apart from
the small patches noted below; the full source of each game is in its folder.

| Folder | Game | Upstream | License |
| --- | --- | --- | --- |
| `trex/` | T-Rex Runner | https://github.com/wayou/t-rex-runner (Chromium) | BSD-3-Clause (`trex/LICENSE`) — patches: arcade-mode vertical centering, removed devicePixelRatio factor from translateY |
| `hextris/` | Hextris | https://github.com/Hextris/hextris | GPL-3.0 (`hextris/LICENSE.md`) — patches: analytics removed |
| `clumsy/` | Clumsy Bird | https://github.com/ellisonleao/clumsy-bird | GPL-3.0 (`clumsy/LICENSE.md`); built with melonJS 4 |
| `invaders/` | Space Invaders | https://github.com/dwmkerr/spaceinvaders | MIT (`invaders/LICENSE`) — patches: analytics removed, canvas sized to the window |
| `pacman/` | Pac-Man | https://github.com/daleharvey/pacman | WTFPL (`pacman/LICENSE`) — patches: game-over hook in `loseLife()` |

GPL-licensed games are redistributed with their complete source in this repository.
