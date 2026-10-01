export const STUDY_ENTRIES: Readonly<Record<string,string>>;
export function dependencyManifest(root:string,entry:string,read?:(file:string,encoding:string)=>unknown):{
  version:number;entry:string;members:[string,string][];hash:string;
};
export function buildStudyManifests(root:string):Record<string,ReturnType<typeof dependencyManifest>>;
