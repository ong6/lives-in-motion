# Design

## Directions

All three share one stage, one story file and one set of era presets; a reader can switch.

| Direction | Look | Motion | Use |
|---|---|---|---|
| **Paper Theatre** (default) | A shophouse proscenium: scalloped valance, side wings, floorboards in era colours. Layers are paper puppets with a hard drop shadow. Caption on a torn paper ticket. | Layers slide in from the wings, drift by depth, exit to alternating sides. | The hackathon demo: shows every model's output, and the paper look forgives rough SAM edges. |
| **Living Archive** | A museum catalogue: each scene is a numbered plate with a double rule, multiply-blended and desaturated; caption as a museum label. | Ink-bleed reveal (clip-path), slow parallax. | The calm, credible reading mode. |
| **Era Shift** | Full bleed. The interface itself (page colour, display face, controls) takes on the decade of the scene. | Colours cross-fade between eras; giant year numerals. | The most distinctive; best on long lives that cross eras (Lee Kuan Yew). |

## Era presets (`lib/eras.ts`)

| Era | Years | Print technique | Easing |
|---|---|---|---|
| Colonial port | 1819–1941 | Copperplate engraving, sepia | power2.out, 1.4 s |
| Occupation | 1942–1945 | Wartime woodcut, one red | power3.inOut, 1.2 s |
| Road to merdeka | 1946–1964 | 1950s lithograph poster | power2.out, 1.1 s |
| Nation building | 1965–1989 | 1970s silkscreen campaign poster | back.out, 0.9 s |
| Global city | 1990–2009 | 1990s risograph, orange and teal | power3.out, 0.8 s |
| Now | 2010– | Contemporary cut-paper collage | expo.out, 0.7 s |

Older eras move slower and heavier. The same preset fills the CSS variables and the Muse Image
prompt, so the generated art and the interface agree.

## Motion rules

- One pinned stage; scroll scrubs a GSAP timeline (enter 0.4, hold 0.4, exit 0.3 per scene).
- Back layers settle first; nearer layers enter later and travel further (parallax by `depth`).
- Text never animates more than a fade and a 14 px rise.
- `prefers-reduced-motion`: no pinning, scenes stacked as stills with captions.

## Hackathon angle

- **Theme:** *Build for Your World*. Singapore's stories exist as text (Infopedia) but not as
  something people want to watch.
- **The demo moment:** press *Layers*. The scene tilts and the SAM 3.1 cut-outs separate in depth,
  each labelled with the concept it was cut by. It shows Spark → Image → SAM working together in one picture.
- **Second beat:** type a new name and watch research, storyboard, plates and cut-outs fill in.
- **Stretch: "your family's story".** Swap web research for a voice interview with a grandparent
  (Muse Spark takes audio) and family photos as Muse Image references. That fits the theme exactly
  and avoids the public-figure likeness issue, because the family consents.
