document.addEventListener('click',event=>{
  const link=event.target.closest('a');
  if(!link)return;
  link.closest('.store-mobile-menu')?.removeAttribute('open');
  const url=new URL(link.href,location.href);
  if(url.hash&&url.origin===location.origin&&url.pathname===location.pathname){
    let id;try{id=decodeURIComponent(url.hash.slice(1));}catch{return;}
    const target=document.getElementById(id);
    if(target){event.preventDefault();target.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});history.replaceState(null,'',url.hash);}
  }
});
document.addEventListener('keydown',event=>{if(event.key==='Escape')document.querySelectorAll('.store-mobile-menu[open]').forEach(menu=>{menu.removeAttribute('open');menu.querySelector('summary')?.focus();});});

if(document.body.dataset.storeDesign==='botanical'&&!document.body.classList.contains('store-motion-disabled')&&!matchMedia('(prefers-reduced-motion: reduce)').matches&&window.top===window.self&&'IntersectionObserver' in window){
  const observer=new IntersectionObserver(entries=>{
    for(const entry of entries)if(entry.isIntersecting){entry.target.animate([{transform:'translateY(12px)'},{transform:'translateY(0)'}],{duration:450,easing:'ease-out'});observer.unobserve(entry.target);}
  },{threshold:.12});
  document.querySelectorAll('.theme-section-inner').forEach(section=>observer.observe(section));
}
