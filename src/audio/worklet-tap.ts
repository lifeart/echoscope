export const MIC_TAP_WORKLET_CODE = `
class MicTapProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input.length > 0) {
      // Forward all channels
      const channelData = [];
      for (let c = 0; c < input.length; c++) {
        if (input[c] && input[c].length > 0) {
          channelData.push(input[c]);
        }
      }
      if (channelData.length > 0) {
        this.port.postMessage(channelData);
      }
    }
    return true;
  }
}
registerProcessor('mic-tap', MicTapProcessor);
`;
