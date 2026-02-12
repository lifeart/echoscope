declare module '@tensorflow/tfjs' {
  const tf: any;
  export default tf;
  export function setBackend(name: string): Promise<boolean>;
  export function ready(): Promise<void>;
  export function loadLayersModel(url: string): Promise<any>;
  export function zeros(shape: number[]): any;
  export function tensor2d(data: number[] | Float32Array, shape: [number, number]): any;
  export function tidy<T>(fn: () => T): T;
}
