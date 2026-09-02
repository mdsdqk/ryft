/**
 * Sign-in arrival — the drawing being inked.
 *
 * One GSAP timeline on the signed-out gate. Speaks `--ease-mark`
 * (`cubic-bezier(0.16, 1, 0.3, 1)`) as a CustomEase so the settle, border
 * draw, word ink, and proof stagger match the dial / rule-in / apply stamp.
 * No ScrollTrigger. Kill on unmount. Skip entirely under reduced motion.
 */

import gsap from "gsap";
import { CustomEase } from "gsap/CustomEase";

gsap.registerPlugin(CustomEase);

const MARK = CustomEase.create("ryftMark", "0.16,1,0.3,1");

function reduced(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Play the arrival against `root` (the `.si` sheet). Calls `onDone` when the
 * field should take focus. Returns a disposer that reverts tweens.
 */
export function playSignInArrival(
  root: HTMLElement,
  onDone: () => void,
): () => void {
  if (reduced()) {
    root.classList.add("si--arrived");
    onDone();
    return () => {
      root.classList.remove("si--arrived");
    };
  }

  const draw = root.querySelector<SVGGeometryElement>("[data-si-draw]");
  const words = root.querySelectorAll<HTMLElement>("[data-si-word]");
  const ours = root.querySelector<HTMLElement>("[data-si-ours]");
  const theirs = root.querySelector<HTMLElement>("[data-si-theirs]");
  const leader = root.querySelector<HTMLElement>("[data-si-leader]");

  const ctx = gsap.context(() => {
    root.classList.add("si--inking");

    gsap.set(root, { y: 16 });
    if (words.length) gsap.set(words, { opacity: 0.32 });
    if (ours) gsap.set(ours, { opacity: 0, y: 6 });
    if (theirs) gsap.set(theirs, { opacity: 0, y: 6 });
    if (leader) gsap.set(leader, { opacity: 0, y: 6 });
    if (draw) gsap.set(draw, { strokeDasharray: 1, strokeDashoffset: 1 });

    const tl = gsap.timeline({
      defaults: { ease: MARK },
      onComplete: () => {
        root.classList.remove("si--inking");
        root.classList.add("si--arrived");
        onDone();
      },
    });

    tl.to(root, { y: 0, duration: 0.42 });
    if (draw) {
      tl.to(draw, { strokeDashoffset: 0, duration: 0.48 }, "-=0.14");
    }
    if (words.length) {
      tl.to(words, { opacity: 1, duration: 0.28, stagger: 0.07 }, "-=0.18");
    }
    if (ours) tl.to(ours, { opacity: 1, y: 0, duration: 0.22 }, "-=0.04");
    if (theirs) tl.to(theirs, { opacity: 1, y: 0, duration: 0.22 }, "-=0.1");
    if (leader) tl.to(leader, { opacity: 1, y: 0, duration: 0.22 }, "-=0.1");
  }, root);

  return () => {
    ctx.revert();
    root.classList.remove("si--inking", "si--arrived");
  };
}
