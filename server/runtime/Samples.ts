export class Samples {
 private values:number[]=[];
 add(value:number){this.values.push(value);if(this.values.length>2048)this.values.shift();}
 summary(){const a=[...this.values].sort((a,b)=>a-b),p=(v:number)=>a.length?a[Math.min(a.length-1,Math.ceil(a.length*v)-1)]:0;return {samples:a.length,median:p(.5),p95:p(.95),p99:p(.99)};}
}
