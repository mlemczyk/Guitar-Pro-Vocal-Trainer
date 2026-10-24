declare module "signalsmith-stretch" {
  const SignalsmithStretch: (ctx: BaseAudioContext, options?: AudioWorkletNodeOptions) => Promise<AudioNode>;
  export default SignalsmithStretch;
}
