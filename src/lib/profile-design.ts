// Constrained presentation data. No executable CSS or HTML is accepted.
export const profileThemes = ['modern','dark','minimal','bold','elegant','executive','creative','business'] as const;
export const profileThemeLabels:Record<(typeof profileThemes)[number],string>={
 modern:'Modern',dark:'Dark',minimal:'Minimal',bold:'Bold',elegant:'Elegant',executive:'Executive',creative:'Creative',business:'Business',
};
export const profileFonts = {arial:'Arial, Helvetica, sans-serif',system:'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',serif:'Georgia, "Times New Roman", serif'} as const;
export const sectionIds = ['about','services','staff','reviews','faq','gallery','policies','contact'] as const;
export type SectionId = typeof sectionIds[number];
export type ProfileSection = {id:SectionId;title:string;visible:boolean;body:string;items:{title:string;body:string;url:string}[]};
export type ProfileDesign = {schemaVersion:1;theme:typeof profileThemes[number];layout:'single'|'sections'|'cards'|'tabbed';primary:string;secondary:string;accent:string;background:string;headingFont:keyof typeof profileFonts;bodyFont:keyof typeof profileFonts;textSize:'small'|'medium'|'large';cover:string;avatar:string;heroTitle:string;heroDescription:string;buttonLabel:string;sections:ProfileSection[]};
/** Professional color starting points — applied when an owner picks a theme preset. */
export const profileThemePresets:Record<(typeof profileThemes)[number],Pick<ProfileDesign,'primary'|'secondary'|'accent'|'background'|'headingFont'|'bodyFont'|'textSize'>>={
 modern:{primary:'#365cff',secondary:'#151b38',accent:'#22c55e',background:'#ffffff',headingFont:'arial',bodyFont:'arial',textSize:'medium'},
 dark:{primary:'#6b8aff',secondary:'#0b1024',accent:'#38bdf8',background:'#111827',headingFont:'system',bodyFont:'system',textSize:'medium'},
 minimal:{primary:'#151b38',secondary:'#151b38',accent:'#365cff',background:'#f7f8fc',headingFont:'system',bodyFont:'system',textSize:'medium'},
 bold:{primary:'#365cff',secondary:'#0f172a',accent:'#f59e0b',background:'#ffffff',headingFont:'arial',bodyFont:'arial',textSize:'large'},
 elegant:{primary:'#1f2937',secondary:'#111827',accent:'#b45309',background:'#fbf7f1',headingFont:'serif',bodyFont:'serif',textSize:'medium'},
 executive:{primary:'#1d4ed8',secondary:'#0f172a',accent:'#0ea5e9',background:'#f8fafc',headingFont:'system',bodyFont:'system',textSize:'medium'},
 creative:{primary:'#7c3aed',secondary:'#1e1b4b',accent:'#f472b6',background:'#ffffff',headingFont:'arial',bodyFont:'system',textSize:'medium'},
 business:{primary:'#0f766e',secondary:'#134e4a',accent:'#365cff',background:'#ffffff',headingFont:'arial',bodyFont:'arial',textSize:'medium'},
};
const titles:Record<SectionId,string>={about:'About us',services:'Our services',staff:'Meet our team',reviews:'Client experiences',faq:'Frequently asked questions',gallery:'Our work',policies:'Booking policies',contact:'Let’s connect'};
export function defaultProfileDesign():ProfileDesign{return {schemaVersion:1,theme:'modern',layout:'sections',primary:'#365cff',secondary:'#151b38',accent:'#22c55e',background:'#ffffff',headingFont:'arial',bodyFont:'arial',textSize:'medium',cover:'',avatar:'',heroTitle:'',heroDescription:'',buttonLabel:'Book an appointment',sections:sectionIds.map(id=>({id,title:titles[id],visible:['about','services','reviews','contact'].includes(id),body:'',items:[]}))};}
export class ProfileDesignError extends Error {}
const text=(v:unknown,max:number,fallback='')=>{if(v===undefined)return fallback;if(typeof v!=='string'||v.length>max)throw new ProfileDesignError(`Use text up to ${max} characters.`);return v.trim();};
function choice<T extends string>(v:unknown,options:readonly T[],fallback:T):T{if(v===undefined)return fallback;if(!options.includes(v as T))throw new ProfileDesignError('Choose a supported style option.');return v as T;}
export function designUrl(v:unknown){const raw=text(v,1000);if(!raw)return '';try{const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password)throw Error();return u.href;}catch{throw new ProfileDesignError('Use a valid HTTPS image or link address.');}}
export function designImage(v:unknown){const raw=text(v,100);if(!raw)return '';if(!/^asset:[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(raw))throw new ProfileDesignError('Upload an image from your device.');return raw;}
export function profileImageUrl(value:string){return value.startsWith('asset:')?`/api/profile-design/image?asset=${encodeURIComponent(value.slice(6))}`:value;}
export function designAssetIds(d:ProfileDesign){return [...new Set([d.cover,d.avatar,...d.sections.flatMap(s=>s.items.map(i=>i.url))].filter(s=>s.startsWith('asset:')).map(s=>s.slice(6)))];}
/** Whether a section item has anything the public renderer would show. */
export function sectionItemHasContent(sectionId:SectionId,item:{title:string;body:string;url:string}){
 if(item.title.trim()||item.body.trim())return true;
 // FAQ ignores URL; gallery/staff can be image-only; other sections treat a link as content.
 if(sectionId==='faq')return false;
 return Boolean(item.url.trim());
}
/** Whether a visible section would show real content on the public page (not preview placeholders). */
export function sectionHasPublicContent(section:ProfileSection,extras?:{bio?:string;hasServices?:boolean;hasReviews?:boolean;hasContact?:boolean}){
 if(!section.visible)return false;
 if(section.body.trim()||section.items.some(i=>sectionItemHasContent(section.id,i)))return true;
 if(section.id==='about'&&extras?.bio?.trim())return true;
 if(section.id==='services'&&extras?.hasServices)return true;
 if(section.id==='reviews'&&extras?.hasReviews)return true;
 if(section.id==='contact'&&extras?.hasContact)return true;
 return false;
}
/** Sparse designs (default empty studio publish) should use the compact digital card, not the long booking layout. */
export function designHasCustomPresentation(d:ProfileDesign){
 if(d.cover||d.avatar||d.heroTitle.trim()||d.heroDescription.trim())return true;
 return d.sections.some(s=>s.visible&&(s.body.trim()||s.items.some(i=>sectionItemHasContent(s.id,i))));
}
/** Compact-card contact list should honor the published contact section visibility. */
export function designShowsContactSection(d:ProfileDesign|null|undefined){
 if(!d)return true;
 const contact=d.sections.find(s=>s.id==='contact');
 return contact?contact.visible:true;
}
export function parseProfileDesign(value:unknown):ProfileDesign{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new ProfileDesignError('Invalid design.');
 if(JSON.stringify(value).length>13000)throw new ProfileDesignError('This design is too large. Shorten some text or remove items.');
 const v=value as Record<string,unknown>,d=defaultProfileDesign();if(v.schemaVersion!==undefined&&v.schemaVersion!==1)throw new ProfileDesignError('Unsupported design version.');
 const color=(k:'primary'|'secondary'|'accent'|'background')=>{if(v[k]===undefined)return d[k];if(typeof v[k]!=='string'||!/^#[0-9a-f]{6}$/i.test(v[k] as string))throw new ProfileDesignError('Choose a six-digit color.');return (v[k] as string).toLowerCase();};
 let sections=d.sections;
 if(v.sections!==undefined){if(!Array.isArray(v.sections)||v.sections.length!==sectionIds.length)throw new ProfileDesignError('Keep each section exactly once.');const seen=new Set();sections=v.sections.map(s=>{if(!s||typeof s!=='object'||!sectionIds.includes(s.id)||seen.has(s.id))throw new ProfileDesignError('Section IDs must be supported and unique.');seen.add(s.id);if(typeof s.visible!=='boolean'||!Array.isArray(s.items)||s.items.length>8)throw new ProfileDesignError('Use up to eight items per section and set its visibility.');return {id:s.id as SectionId,title:text(s.title,100,titles[s.id as SectionId]),visible:s.visible,body:text(s.body,1800),items:s.items.map((i:Record<string,unknown>)=>{if(!i||typeof i!=='object')throw new ProfileDesignError('Invalid section item.');return {title:text(i.title,120),body:text(i.body,800),url:(['gallery','staff'].includes(s.id)?designImage(i.url):designUrl(i.url))};})};});}
 return {schemaVersion:1,theme:choice(v.theme,profileThemes,d.theme),layout:choice(v.layout,['single','sections','cards','tabbed'],d.layout),primary:color('primary'),secondary:color('secondary'),accent:color('accent'),background:color('background'),headingFont:choice(v.headingFont,['arial','system','serif'],d.headingFont),bodyFont:choice(v.bodyFont,['arial','system','serif'],d.bodyFont),textSize:choice(v.textSize,['small','medium','large'],d.textSize),cover:designImage(v.cover),avatar:designImage(v.avatar),heroTitle:text(v.heroTitle,140),heroDescription:text(v.heroDescription,600),buttonLabel:text(v.buttonLabel,50,d.buttonLabel),sections};
}
export function foreground(hex:string){const a=hex.slice(1).match(/../g)!.map(n=>{const v=parseInt(n,16)/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});const luminance=a[0]*.2126+a[1]*.7152+a[2]*.0722;return luminance>.25?'#151b38':luminance>.179?'#000000':'#ffffff';}
export function moveSection(sections:ProfileSection[],id:SectionId,target:number){const copy=[...sections],index=copy.findIndex(s=>s.id===id);if(index<0||target<0||target>=copy.length)return copy;const [item]=copy.splice(index,1);copy.splice(target,0,item);return copy;}
