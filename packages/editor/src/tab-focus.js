/** Let the next Tab use native focus traversal after Escape, without losing editor Tab bindings. */
export function installTabEscape(input) {
  let armed=false;
  const previous=input.getAttribute('aria-description');
  const hint='Press Escape, then Tab or Shift+Tab to move focus from the editor text input.';
  input.setAttribute('aria-description',previous?previous+' '+hint:hint);
  const keydown=event=>{
    if(event.isComposing){armed=false;return;}
    if(event.key==='Escape'&&!event.ctrlKey&&!event.metaKey&&!event.altKey){armed=true;return;}
    if(event.key==='Shift'||event.key==='Alt')return;
    const leave=armed&&event.key==='Tab'&&!event.ctrlKey&&!event.metaKey;
    armed=false;
    // Stop editor handlers (including CodeMirror), but preserve the browser's default action.
    if(leave)event.stopImmediatePropagation();
  };
  const reset=()=>{armed=false;};
  input.addEventListener('keydown',keydown,true);
  input.addEventListener('blur',reset);
  input.addEventListener('pointerdown',reset);
  return ()=>{
    armed=false;input.removeEventListener('keydown',keydown,true);input.removeEventListener('blur',reset);input.removeEventListener('pointerdown',reset);
    if(previous===null)input.removeAttribute('aria-description');else input.setAttribute('aria-description',previous);
  };
}
