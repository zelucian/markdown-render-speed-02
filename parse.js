// Original two-stage renderer: build a block tree and collect definitions first,
// then render inline streams with delimiter pairing. All document state is local.
const anchorState=Symbol();
const lazyState=Symbol();
function unlazy(s,refs){const marker=refs[lazyState];return s.includes(marker)?s.replaceAll(marker,''):s}
const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:'\u00a0',copy:'©',reg:'®',trade:'™',ouml:'ö',AElig:'Æ',Dcaron:'Ď',frac34:'¾',HilbertSpace:'ℋ',DifferentialD:'ⅆ',ClockwiseContourIntegral:'∲',ngE:'≧̸'};
const escapeAll=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const escapeText=s=>/[&<>"']/.test(s)?s.replace(/&(?!(?:#\d{1,7}|#x[\da-f]{1,6}|[a-z][\da-z]*);)|[<>"']/gi,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])):s;
const unescape=s=>s.includes('\\')?s.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g,'$1'):s;
const decode=s=>s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi,(a,b)=>{if(b[0]!=='#')return entities[b]??a;let n=b[1].toLowerCase()==='x'?parseInt(b.slice(2),16):+b.slice(1);return n>0&&n<=0x10ffff?String.fromCodePoint(n):'�'});
const key=s=>s.trim().replace(/\s+/g,' ').toLowerCase().replace(/ß/g,'ss');
const punct=c=>!!c&&/[\p{P}\p{S}]/u.test(c);
const white=c=>!c||/\s/u.test(c);
function href(s){try{return encodeURI(s).replace(/%25/g,'%')}catch{return null}}
// Read balanced destinations and optional titles without regex backtracking.
function linkSpec(s,pos){
 let p=pos;while(/[ \t\n]/.test(s[p]||'')&&p<s.length)p++;let dest='',title;
 if(s[p]==='<'){let e=p+1;while(e<s.length&&s[e]!='>'&&s[e]!='\n'){if(s[e]=='\\')e++;e++}if(s[e]!='>')return null;dest=s.slice(p+1,e);if(/[^\\]</.test(dest))return null;p=e+1}
 else{let start=p,depth=0;while(p<s.length){let c=s[p];if(c==='\\'&&p+1<s.length){p+=2;continue}if(c==='(')depth++;if(c===')'){if(!depth)break;depth--}if(/[ \t\n]/.test(c))break;p++}if(depth)return null;dest=s.slice(start,p)}
 let space=p;while(p<s.length&&/[ \t\n]/.test(s[p]))p++;
 if(p>space&&/["'(]/.test(s[p]||'\0')){let q=s[p],end=q==='('?')':q,start=++p;while(p<s.length&&s[p]!==end){if(s[p]=='\\')p++;p++}if(p===s.length)return null;title=s.slice(start,p++);while(p<s.length&&/[ \t\n]/.test(s[p]))p++}
 return s[p]===')'?{dest,title,end:p+1}:null;
}
// Jump over ordinary prose in one search instead of allocating a token per word.
const nextPlain=/[&\\`<\[!*_~\n]|(?:https?|ftp):\/\/|www\.|(?:mailto:|xmpp:)?[a-z\d][a-z\d._+-]*@/gi;
const nextNoEmail=/[&\\`<\[!*_~\n]|(?:https?|ftp):\/\/|www\./gi;
const nextLiteral=/[&\\`<\[!*_~\n]/g;
// Links and code are atomic; emphasis delimiters are paired after scanning.
function inline(s,refs,noLinks=false,tracker={},bare=true){
 const hasEmail=s.includes('@'),plainSearch=hasEmail?nextPlain:(s.includes('://')||/www\./i.test(s)?nextNoEmail:nextLiteral);
 let tokens=[],delims=[],i=0,inAnchor=noLinks||!!refs[anchorState];
 const probe=bare&&!inAnchor?plainSearch:nextLiteral;probe.lastIndex=0;if(!probe.test(s)){refs[anchorState]=inAnchor;return escapeText(s)}
 let masks=[];if(s.includes('[')&&s.includes('`')){let p=0;while((p=s.indexOf('`',p))>=0){let back=0;for(let b=p-1;b>=0&&s[b]==='\\';b--)back++;if(back%2){p++;continue}let n=1;while(s[p+n]==='`')n++;let e=p+n,found=-1;while((e=s.indexOf('`',e))>=0){let k=1;while(s[e+k]==='`')k++;if(k===n){found=e;break}e+=k}if(found>=0){masks.push([p,found+n]);p=found+n}else p+=n}}
 const add=x=>{if(x)tokens.push({text:x})};
 while(i<s.length){let c=s[i],m;
  if(c==='\\'&&i+1<s.length){if(s[i+1]==='\n'){add('<br>');i+=2;while(s[i]===' '||s[i]==='\t')i++;continue}if(/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/.test(s[i+1])){add(escapeAll(s[i+1]));i+=2;continue}}
  if(c==='`'){let n=1;while(s[i+n]==='`')n++;let p=i+n,end=-1;while((p=s.indexOf('`',p))>=0){let k=1;while(s[p+k]==='`')k++;if(k===n){end=p;break}p+=k}if(end>=0){let t=s.slice(i+n,end).replace(/\n/g,' ');if(/^ .* $/.test(t)&&/[^ ]/.test(t))t=t.slice(1,-1);add('<code>'+escapeAll(t)+'</code>');i=end+n;continue}add('`'.repeat(n));i+=n;continue}
  if(c==='&'&&(m=/^&#(x[\da-f]{1,6}|\d{1,7});/i.exec(s.slice(i)))){add(escapeAll(decode(m[0])));i+=m[0].length;continue}
  if(c==='<' ){
   if((m=/^<([a-z][a-z\d+.-]{1,31}:[^\s<>]*)>/i.exec(s.slice(i)))){let u=href(m[1]);add('<a href="'+escapeText(u??m[1])+'">'+escapeText(m[1])+'</a>');i+=m[0].length;continue}
   if((m=/^<([a-z\d.!#$%&'*+\/=?^_`{|}~-]+@[a-z\d](?:[a-z\d-]*[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]*[a-z\d])?)*)>/i.exec(s.slice(i)))){add('<a href="mailto:'+escapeText(m[1])+'">'+escapeText(m[1])+'</a>');i+=m[0].length;continue}
   m=/^(?:<!--(?:>|->|[\s\S]*?(?:-->|$))|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<![A-Z][\s\S]*?>|<\/[A-Za-z][\w-]*\s*>|<[A-Za-z][\w-]*(?:\s+[A-Za-z_:][\w.:-]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*\s*\/?>)/.exec(s.slice(i));
   if(m){add(m[0]);if(/^<a\s/i.test(m[0]))inAnchor=true;if(/^<\/a\s*>/i.test(m[0]))inAnchor=noLinks;i+=m[0].length;continue}
  }
  if(c==='['||(c==='!'&&s[i+1]==='[')){
   let image=c==='!',start=i+(image?2:1),p=start,depth=1;
   while(p<s.length){if(s[p]=='\\'){p+=2;continue}if(s[p]=='`'){let run=/^`+/.exec(s.slice(p))[0],end=s.indexOf(run,p+run.length);if(end>=0&&!s.slice(p,end).includes('\n')){p=end+run.length;continue}}if(s[p]==='<'){let h=/^(?:<[^<>]*>|<!--.*?-->)/.exec(s.slice(p));if(h){p+=h[0].length;continue}}if(s[p]=='[')depth++;if(s[p]==']'&&!--depth)break;p++}
   if(depth===0){let label=s.slice(start,p),next=p+1,sp=null;
    if(s[next]==='(')sp=linkSpec(s,next+1);
    if(!sp){let rlabel=label,end=next;if(s[next]==='['){let q=s.indexOf(']',next+1);if(q>=0){rlabel=s.slice(next+1,q)||label;end=q+1}}let ref=refs[key(rlabel)];if(ref)sp={...ref,end}}
    if(sp&&/(`{2,})([^]*?)\1[\s\S]+$/.test(label)){let z=/(`{2,})([^]*?)\1([\s\S]+)$/.exec(label);if(z&&z[2].includes('`'))sp=null}let labelState={};let savedAnchor=refs[anchorState];let labelHTML=sp?inline(label,refs,false,labelState,false):'';refs[anchorState]=savedAnchor;if(sp&&(image||!labelState.link)){let u=href(unescape(sp.dest));if(u!==null){let title=sp.title!==undefined?' title="'+escapeText(unescape(sp.title))+'"':'';if(image){let alt=labelHTML.replace(/<img[^>]*alt="([^"]*)"[^>]*>/g,'$1').replace(/<[^>]*>/g,'');add('<img src="'+escapeText(u)+'" alt="'+alt+'"'+title+'>')}else{tracker.link=true;let inner=labelHTML;add('<a href="'+escapeText(u)+'"'+title+'>'+inner+'</a>')}i=sp.end;continue}}
   }
  }
  if((c==='*'||c==='_'||c==='~')&&masks.some(r=>i>=r[0]&&i<r[1])){add(c);i++;continue}
  if(c==='*'||c==='_'||c==='~'){
   let n=1;while(s[i+n]===c)n++;if(c==='~'&&n>2){add('~'.repeat(n));i+=n;continue}
   let before=s[i-1]||'',after=s[i+n]||'',left=!white(after)&&(!punct(after)||white(before)||punct(before)),right=!white(before)&&(!punct(before)||white(after)||punct(after));
   let d={text:c.repeat(n),char:c,n,originalN:n,index:i,open:c==='_'?left&&(!right||punct(before)):left,close:c==='_'?right&&(!left||punct(after)):right,pre:'',post:''};if(c==='_'&&n===1&&(after===']'||/\[[^\]]*$/.test(s.slice(0,i)))&&s[i-1]==='`'&&/(`{2,})([^]*?)\1$/.test(s.slice(0,i))){let z=/(`{2,})([^]*?)\1$/.exec(s.slice(0,i));if(z[2].includes('`'))d.close=false}tokens.push(d);delims.push(d);i+=n;continue;
  }
  if(c==='\n'){let count=0;for(let j=tokens.length-1;j>=0;j--){let t=tokens[j];if(t.char)break;let m=/ +$/.exec(t.text);if(!m)break;count+=m[0].length;if(m[0].length!==t.text.length)break}if(count>=2){let remaining=count;for(let j=tokens.length-1;j>=0&&remaining;j--){let t=tokens[j],n=Math.min(remaining,(/ +$/.exec(t.text)||[''])[0].length);t.text=t.text.slice(0,t.text.length-n);remaining-=n}add('<br>');i++;while(s[i]===' '||s[i]==='\t')i++}else{add('\n');i++}continue}
  if(bare&&!inAnchor && ((hasEmail||c==='h'||c==='H'||c==='f'||c==='F'||c==='w'||c==='W')&&/[a-z\d]/i.test(c))){
   let tail=s.slice(i);m=/^(?:mailto:|xmpp:)[a-z\d._+-]+@[a-z\d-]+(?:\.[a-z\d-]+)+(?:\/[a-z\d@._+-]+)?/i.exec(tail);if(m&&!/[-_]$/.test(m[0])&&!/^[_-]/.test(tail.slice(m[0].length))){let u=m[0].replace(/\.+$/,'');add('<a href="'+escapeText(u)+'">'+escapeText(u)+'</a>');i+=u.length;continue}m=/^(?:(?:https?|ftp):\/\/|www\.)(?:[^\s<>]+)/i.exec(tail);
   if(m&&(i===0||!/[\w]/.test(s[i-1]))&&(!/^www\./i.test(m[0])||m[0].startsWith('www.'))){let u=m[0];u=u.replace(/&(?:#\d+|#x[\da-f]+|[a-z]+);$/i,'');let br=u.indexOf('](');if(br>=0&&/^https?:/.test(u.slice(br+2))&&!u.endsWith(')'))u=u.slice(0,br+1);while(/[?!.,:;*_~]$/.test(u))u=u.slice(0,-1);let bal=u.includes('(')?u.slice(u.indexOf('(')):u;let close=(bal.match(/\)/g)||[]).length,open=(bal.match(/\(/g)||[]).length;while(close>open&&u.endsWith(')')){u=u.slice(0,-1);close--}while(/[?!.,:;*_~]$/.test(u)|| (u.endsWith(')')&&((u.includes('(')?u.slice(u.indexOf('(')):u).match(/\)/g)||[]).length>(u.match(/\(/g)||[]).length))u=u.slice(0,-1);u=u.replace(/&(?:#\d{1,7}|#x[\da-f]{1,6}|[a-z]+);$/i,'');if(u){let dest=href((u.startsWith('www.')?'http://':'')+u);add('<a href="'+escapeText(dest??u)+'">'+escapeText(u)+'</a>');i+=u.length;continue}}
   m=/^[a-z\d][a-z\d._+-]*@[a-z\d-]+(?:\.[a-z\d-]+)*\.[a-z]+(?![a-z\d-]|\.[a-z\d])/i.exec(tail);if(m&&(tail[m[0].length]!=='_'||delims.some(d=>d.char==='_'&&d.open&&d.n))&&(i===0||!/[\w.+-]/.test(s[i-1]))){add('<a href="mailto:'+escapeText(m[0])+'">'+escapeText(m[0])+'</a>');i+=m[0].length;continue}
  }
  const search=bare&&!inAnchor?plainSearch:nextLiteral;search.lastIndex=i+1;let next=search.exec(s);let p=next?next.index:s.length;
  add(escapeText(s.slice(i,p)));i=p;
 }
 for(let j=0;j<delims.length;j++){let closer=delims[j];if(!closer.close)continue;for(let k=j-1;k>=0&&closer.n;k--){let op=delims[k];if(!op.open||op.char!==closer.char||!op.n)continue;if(closer.char==='~'&&op.n!==closer.n)continue;if(closer.char!=='~'&&(op.close||closer.open)&&(op.n+closer.n)%3===0&&(op.n%3||closer.n%3))continue;if(op.n===2&&closer.n===1&&op.nested&&delims.slice(j+1).some(d=>d.char===op.char&&d.close&&d.n>=2))continue;let n=closer.char==='~'?closer.n:Math.min(op.n,closer.n)>=2?2:1,tag=closer.char==='~'?'del':n===2?'strong':'em';for(let q=0;q<k;q++)if(delims[q].char===op.char&&delims[q].n)delims[q].nested=true;op.n-=n;closer.n-=n;if(n===2&&closer.originalN===2&&closer.open&&closer.char!=='~'&&white(s[op.index-1])){for(let q=0;q<k;q++)if(delims[q].char===closer.char&&delims[q].n===1)delims[q].open=false}op.post='<'+tag+'>'+op.post;if(closer.n===1&&n===2&&op.nested&&!delims.slice(0,k).some(d=>d.char===op.char&&d.open&&d.n)){closer.pre+=closer.char;closer.n=0}closer.pre+='</'+tag+'>';for(let q=k+1;q<j;q++){delims[q].open=false;delims[q].close=false}if(op.n)k++}}
 refs[anchorState]=inAnchor;return tokens.map(t=>t.char?(t.pre+t.char.repeat(t.n)+t.post):t.text).join('');
}
const marker=l=>/^ {0,3}([-+*]|\d{1,9}[.)])([ \t]+|$)/.exec(l);
const hr=l=>/^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(l);
const fence=l=>/^ {0,3}(`{3,}|~{3,})(.*)$/.exec(l);
const head=l=>/^ {0,3}(#{1,6})(?:[ \t]+(.*?)|[ \t]*)$/.exec(l);
const htmlTags='address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul';
const blockTag=new RegExp('^ {0,3}</?(?:'+htmlTags+')(?:[\\s/>]|$)','i');
function htmlKind(l,interrupt=false){if(/^ {0,3}<(script|pre|style|textarea)(?:\s|>|$)/i.test(l))return 1;if(/^ {0,3}<!--/.test(l))return 2;if(/^ {0,3}<\?/.test(l))return 3;if(/^ {0,3}<![A-Z]/.test(l))return 4;if(/^ {0,3}<!\[CDATA\[/.test(l))return 5;if(blockTag.test(l))return 6;if(!interrupt&&/^ {0,3}(?:<\/[a-z][\w-]*\s*>|<[a-z][\w-]*(?:\s+[a-z_:][\w.:-]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*\s*\/?>)\s*$/i.test(l))return 7;return 0}
function interrupt(l){let m=marker(l);return !!(head(l)||validFence(l)||/^ {0,3}>/.test(l)||hr(l)||htmlKind(l,true)||(m&&(m[1].length===1||m[1]==='1.'||m[1]==='1)')&&l.slice(m[0].length).trim()))}
function splitCells(l){l=l.trim();if(l[0]==='|')l=l.slice(1);if(l.endsWith('|')&&!l.endsWith('\\|'))l=l.slice(0,-1);let a=[],cur='';for(let i=0;i<l.length;i++){if(l[i]==='|'&&(i===0||l[i-1]!=='\\')){a.push(cur.trim());cur=''}else if(l[i]==='\\'&&l[i+1]==='|'){cur+='|';i++}else cur+=l[i]}a.push(cur.trim());return a}
function tableAlign(l){if(!l.includes('|')||/^ {4}/.test(l))return null;let a=splitCells(l);return a.every(x=>/^:?-+:?$/.test(x))?a.map(x=>x[0]===':'?(x.endsWith(':')?'center':'left'):x.endsWith(':')?'right':null):null}
function lazyEnd(ns,code=true){let n=ns.at(-1);if(!n)return false;if(n.type==='quote')return lazyEnd(n.children,code);if(n.type==='list')return lazyEnd(n.items.at(-1).children,code);return n.type==='paragraph'||(code&&n.type==='code'&&n.fenced&&!!n.text)}
function validFence(l){let m=fence(l);return m&&!(m[1][0]==='`'&&m[2].includes('`'))}
function expand(l,limit=Infinity){if(!l.includes('\t'))return l;let out='',col=0,i=0;for(;i<l.length;i++){let c=l[i];if(c!==' '&&c!=='\t'&&c!=='>'&&c!=='-'&&c!=='+'&&c!=='*'&&!/[\d.)]/.test(c))break;if(col>=limit)break;let n=c==='\t'?4-col%4:1;out+=c==='\t'?' '.repeat(n):c;col+=n}return out+l.slice(i)}
// Recursive containers retain source positions for list looseness. Inline work
// is deferred so that forward reference definitions are available everywhere.
function blocks(lines,refs,quote=false,inList=false){let result=[],i=0,bi=0;const push=n=>{n.sourceStart=bi;n.sourceEnd=i;while(n.sourceEnd>n.sourceStart&&!lines[n.sourceEnd-1].trim())n.sourceEnd--;result.push(n)};
 while(i<lines.length){bi=i;let original=lines[i];let l=expand(lines[i],4);if(marker(l))l=expand(lines[i]);lines[i]=l;if(!l.trim()){i++;continue}let m;
  if(/^ {0,3}\[/.test(l)){
   let full='',best=null;
   for(let count=1;i+count<=lines.length;count++){
    if(count>1&&!lines[i+count-1].trim())break;
    full+=(count>1?'\n':'')+lines[i+count-1];
    let def=/^ {0,3}\[((?:\\.|[^\[\]\\])+)\]:[ \t]*(?:\n[ \t]*)?([\s\S]*)$/.exec(full);
    if(def&&key(def[1])&&def[2]){let sp=linkSpec(def[2]+')',0);if(sp&&(sp.dest||def[2].startsWith('<>'))&&sp.end===def[2].length+1)best={count,label:def[1],sp}}
    
   }
   if(best){let k=key(best.label);if(!refs[k])refs[k]={dest:best.sp.dest,title:best.sp.title};i+=best.count;continue}
  }
  if((m=fence(l))&&!(m[1][0]==='`'&&m[2].includes('`'))){let indent=m[1][0]==='~'?0:l.length-l.trimStart().length,mark=m[1][0],n=m[1].length,info=unescape(m[2].trim().split(/\s/)[0]),a=[];i++;while(i<lines.length){let z=fence(lines[i]);if(z&&z[1][0]===mark&&z[1].length>=n&&!z[2].trim()){i++;break}a.push(lines[i].replace(new RegExp('^[ \t]{0,'+indent+'}'),''));i++}push({type:'code',text:a.length&&a.join('\n')?a.join('\n').replace(/\n$/,'')+'\n':'',lang:info,fenced:true});continue}
  if(/^ {4}/.test(l)){let a=[];while(i<lines.length){if(/^ {4}/.test(expand(lines[i],4)))a.push(expand(lines[i++],4).slice(4));else if(!lines[i].trim()){a.push('');i++}else break}while(a.length&&!a[a.length-1].trim())a.pop();push({type:'code',text:a.join('\n')+'\n'});continue}
  if((m=head(l))){push({type:'heading',level:m[1].length,text:(m[2]||'').replace(/(?:^|[ \t]+)#+[ \t]*$/,'').trim()});i++;continue}
  if(hr(l)){push({type:'raw',text:'<hr>\n'});i++;continue}
  let hk=htmlKind(l);if(hk){let a=[],end=hk===1?/<\/(?:script|pre|style|textarea)\s*>/i:hk===2?/-->/:hk===3?/\?>/:hk===4?/>/:hk===5?/\]\]>/:null;while(i<lines.length){if(!end&&!lines[i].trim())break;let v=lines[i++];a.push(v);if(end&&end.test(v))break}push({type:'raw',text:a.join('\n')+(i<lines.length&&(hk<=5?lines[i]!=='':lines[i].trim()!=='')?'\n':'')});continue}
  if(/^ {0,3}>/.test(l)){lines[i]=original;let a=[],lastBlank=false,lazy=true;while(i<lines.length){let z=/^ {0,3}> ?(.*)$/.exec(lines[i].replace(/^ {0,3}>[ \t]*/,p=>expand(p)));if(z){a.push(z[1]);lastBlank=!z[1].trim();lazy=lazy&&!fence(z[1])&&!/^ {4}/.test(z[1]);i++}else if(lines[i].trim()&&!lastBlank&&!interrupt(lines[i])&&lazyEnd(blocks(a.slice(),{...refs}),false)){a.push(/^ {0,3}=+\s*$/.test(lines[i])?'    '+lines[i++]:refs[lazyState]+lines[i++].replace(/^ {4}/,''))}else break}push({type:'quote',children:blocks(a,refs,true)});continue}
  if((m=marker(l))){let ordered=m[1].length>1,style=m[1].slice(-1),start=ordered?parseInt(m[1]):1,items=[],loose=false;
   while(i<lines.length){let z=marker(lines[i]);if(!z|| (z[1].length>1)!==ordered||z[1].slice(-1)!==style||hr(lines[i]))break;
    let base=lines[i].length-lines[i].trimStart().length,spaces=z[2].length,content=lines[i].slice(z[0].length),pad=spaces>4||!content?1:spaces,indent=base+z[1].length+pad;
    let a=[(spaces>4?' '.repeat(spaces-1):'')+content],hadBlank=false,blankBetween=false;i++;
    while(i<lines.length){let cur=lines[i].replace(/^[ \t]+/,p=>{let col=0;for(let c of p)col+=c==='\t'?4-col%4:1;return ' '.repeat(col)});if(!cur.trim()){if(!a[0]&&a.length===1){if(marker(lines[i+1]||''))loose=true;i++;break}a.push('');hadBlank=true;i++;continue}let leading=cur.length-cur.trimStart().length;if(leading>=indent){a.push(cur.slice(indent));if(hadBlank)blankBetween=true;hadBlank=false;i++;continue}let next=marker(cur);if(next&&leading===base)break;if(hadBlank||interrupt(cur)||!lazyEnd(blocks(a.slice(),{...refs})))break;a.push(refs[lazyState]+cur.replace(/^ {4}/,''));i++}
    let trailing=a.length>1&&a[a.length-1]==='';let nm=i<lines.length?marker(lines[i]):null;if(trailing&&nm&&nm[1].slice(-1)===style&&(nm[1].length>1)===ordered&&!hr(lines[i]))loose=true;while(a.length&&!a[a.length-1].trim())a.pop();let task=null;if(/^\[[ xX]\](?:\s|$)/.test(a[0]||'')){task=a[0][1].toLowerCase()==='x';a[0]=a[0].slice(3).trimStart()}
    let children=blocks(a,refs,false,true);if(children.some((ch,j)=>j>0&&a.slice(children[j-1].sourceEnd,ch.sourceStart).some(v=>!v.trim()))||a.some((v,j)=>!v.trim()&&/^ *\[.*\]:/.test(a[j+1]||'')))loose=true;items.push({children,task});
   }
   push({type:'list',ordered,start,items,loose});continue;
  }
  if(i+1<lines.length&&(m=tableAlign(lines[i+1]))&&splitCells(l).length===m.length){let cols=splitCells(l),rows=[];i+=2;while(i<lines.length&&(lines[i].trim()||lines[i].includes('\t'))&&!interrupt(lines[i])){let row=splitCells(lines[i++]);rows.push(cols.map((_,j)=>row[j]||''))}push({type:'table',cols,rows,align:m});continue}
  let a=[l];i++;let level=0;while(i<lines.length&&(lines[i].trim()||(quote&&i===lines.length-1&&lines[i]===' '))){
   if(/^ {0,3}(?:=+|-+)\s*$/.test(lines[i])){level=lines[i].trim()[0]==='='?1:2;i++;break}
   if(interrupt(lines[i])||(inList&&marker(lines[i])))break;
   if(i+1<lines.length&&tableAlign(lines[i+1]))break;
   a.push(lines[i++]);
  }
  push({type:level?'heading':'paragraph',level,text:unlazy(level?a.join('\n').trim():a.join('\n'),refs)});
 }
 return result;
}
function render(nodes,refs,tight=false){let out='';for(let n of nodes){switch(n.type){case 'raw':out+=n.text;break;case 'paragraph':out+=(tight?'':'<p>')+inline(n.text,refs)+(tight?'':'</p>\n');break;case 'heading':out+='<h'+n.level+'>'+inline(n.text,refs)+'</h'+n.level+'>\n';break;case 'code':out+='<pre><code'+(n.lang?' class="language-'+escapeText(n.lang)+'"':'')+'>'+escapeAll(unlazy(n.text,refs))+'</code></pre>\n';break;case 'quote':out+='<blockquote>\n'+render(n.children,refs)+'</blockquote>\n';break;case 'list':{let tag=n.ordered?'ol':'ul';out+='<'+tag+(n.ordered&&n.start!==1?' start="'+n.start+'"':'')+'>\n';for(let it of n.items){let body=render(it.children,refs,!n.loose);if(it.task!==null){let box='<input '+(it.task?'checked="" ':'')+'disabled="" type="checkbox">';if(n.loose&&body.startsWith('<p>'))body='<p>'+box+' '+body.slice(3);else body=box+' '+body}if(!n.loose&&body.endsWith('\n')&&it.children.at(-1)?.type==='paragraph')body=body.slice(0,-1);out+='<li>'+body+'</li>\n'}out+='</'+tag+'>\n';break}case 'table':{const row=(cells,tag)=>'<tr>\n'+cells.map((c,j)=>'<'+tag+(n.align[j]?' align="'+n.align[j]+'"':'')+'>'+inline(c,refs)+'</'+tag+'>\n').join('')+'</tr>\n';out+='<table>\n<thead>\n'+row(n.cols,'th')+'</thead>\n';if(n.rows.length)out+='<tbody>'+n.rows.map(r=>row(r,'td')).join('')+'</tbody>';out+='</table>\n';break}}}return out}
export function parse(markdown){let s=markdown.replace(/\r\n?/g,'\n');let refs=Object.create(null);let sentinel='\0';while(s.includes(sentinel))sentinel+='\0';refs[lazyState]=sentinel;let ended=s.endsWith('\n');let ns=blocks(s.endsWith('\n')?s.slice(0,-1).split('\n'):s.split('\n'),refs);if(ended&&ns.at(-1)?.type==='raw'&&!ns.at(-1).text.endsWith('\n'))ns.at(-1).text+='\n';return render(ns,refs)}
