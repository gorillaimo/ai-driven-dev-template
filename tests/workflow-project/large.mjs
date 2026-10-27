import { input, feature } from './helpers.mjs';
export function large(count=1000, edges=10000) {
 const fs=Array.from({length:count},(_,n)=>feature('f'+String(n).padStart(4,'0'),Array.from({length:Math.min(n,10)},(_,j)=>'f'+String(n-j-1).padStart(4,'0'))));
 let total=fs.reduce((n,f)=>n+f.depends_on.length,0);
 for(let n=11;n<count&&total<edges;n++,total++)fs[n].depends_on.push({feature_id:'f'+String(n-11).padStart(4,'0'),reason:'Additional contract.'});
 return input(fs);
}
