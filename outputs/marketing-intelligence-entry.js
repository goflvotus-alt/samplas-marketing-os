/* SAMPLAS Marketing Intelligence: navigation-only integration, no existing panel mutation. */
(()=>{'use strict';
 const TARGET='/marketing-intelligence.html';
 const mark='data-marketing-intelligence-entry';
 function mount(){
   const slot=document.getElementById('intelligenceMarketingSlot');
   if(slot && !slot.querySelector('a['+mark+']')){
     const link=document.createElement('a');link.setAttribute(mark,'slot');link.href=TARGET;
     link.textContent='Marketing Intelligence 열기';
     link.style.cssText='display:inline-block;margin-top:12px;padding:9px 13px;border-radius:8px;background:#233b4c;color:white;text-decoration:none;font-weight:700;font-size:12px';
     slot.appendChild(link);
   }
   const nav=document.getElementById('nav');
   if(nav && !nav.querySelector('a['+mark+']')){
     const el=document.createElement('a');el.setAttribute(mark,'nav');el.href=TARGET;
     el.textContent='Marketing Intelligence';el.setAttribute('aria-label','Marketing Intelligence');
     el.style.cssText='display:block;padding:11px 14px;margin:6px 0;border:1px solid rgba(120,140,150,.25);border-radius:9px;text-decoration:none;color:inherit;font-weight:750;font-size:13px';
     const contentNav=[...nav.querySelectorAll('button,a')].find(x=>x.textContent.trim()==='Content');
     if(contentNav)contentNav.insertAdjacentElement('afterend',el);else nav.appendChild(el);
   }
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
 let queued=false;const obs=new MutationObserver(()=>{if(!queued){queued=true;queueMicrotask(()=>{queued=false;mount()})}});
 const begin=()=>{const nav=document.getElementById('nav');if(nav)obs.observe(nav,{childList:true,subtree:false})};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',begin,{once:true});else begin();
})();