use wasm_bindgen::prelude::*;
use rustfft::{FftPlanner, num_complex::Complex};

#[wasm_bindgen]
pub fn fft_correlate(signal: &[f32], reference: &[f32]) -> Vec<f32> {
    let sig_len = signal.len();
    let ref_len = reference.len();
    if sig_len == 0 || ref_len == 0 || sig_len < ref_len {
        return vec![];
    }

    let l = sig_len + ref_len - 1;
    let n = l.next_power_of_two();

    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(n);
    let ifft = planner.plan_fft_inverse(n);

    // Prepare signal
    let mut x: Vec<Complex<f32>> = signal.iter().map(|&v| Complex::new(v, 0.0)).collect();
    x.resize(n, Complex::new(0.0, 0.0));

    // Prepare reference
    let mut s: Vec<Complex<f32>> = reference.iter().map(|&v| Complex::new(v, 0.0)).collect();
    s.resize(n, Complex::new(0.0, 0.0));

    // Forward FFT
    fft.process(&mut x);
    fft.process(&mut s);

    // Multiply X * conj(S)
    let mut product: Vec<Complex<f32>> = x.iter().zip(s.iter())
        .map(|(xi, si)| xi * si.conj())
        .collect();

    // Inverse FFT
    ifft.process(&mut product);

    // Scale and extract valid region
    let scale = 1.0 / n as f32;
    let valid_len = sig_len - ref_len + 1;
    product[..valid_len].iter().map(|c| c.re * scale).collect()
}

#[wasm_bindgen]
pub fn gcc_phat(sig1: &[f32], sig2: &[f32]) -> Vec<f32> {
    let len1 = sig1.len();
    let len2 = sig2.len();
    if len1 == 0 || len2 == 0 {
        return vec![];
    }

    let l = len1 + len2 - 1;
    let n = l.next_power_of_two();

    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(n);
    let ifft = planner.plan_fft_inverse(n);

    let mut x1: Vec<Complex<f32>> = sig1.iter().map(|&v| Complex::new(v, 0.0)).collect();
    x1.resize(n, Complex::new(0.0, 0.0));

    let mut x2: Vec<Complex<f32>> = sig2.iter().map(|&v| Complex::new(v, 0.0)).collect();
    x2.resize(n, Complex::new(0.0, 0.0));

    fft.process(&mut x1);
    fft.process(&mut x2);

    // Cross-power spectrum with PHAT weighting
    let mut product: Vec<Complex<f32>> = x1.iter().zip(x2.iter())
        .map(|(a, b)| {
            let g = a * b.conj();
            let mag = g.norm();
            if mag > 1e-12 { g / mag } else { Complex::new(0.0, 0.0) }
        })
        .collect();

    ifft.process(&mut product);

    let scale = 1.0 / n as f32;
    product.iter().map(|c| c.re * scale).collect()
}

#[wasm_bindgen]
pub fn delay_and_sum(
    channels_flat: &[f32],
    n_channels: usize,
    n_samples: usize,
    delays: &[f32],
) -> Vec<f32> {
    if n_channels == 0 || n_samples == 0 {
        return vec![];
    }

    let mut output = vec![0.0f32; n_samples];

    for ch in 0..n_channels {
        let offset = ch * n_samples;
        let delay = delays.get(ch).copied().unwrap_or(0.0);
        let int_delay = delay.floor() as i32;
        let frac = delay - delay.floor();

        for i in 0..n_samples {
            let idx = i as i32 - int_delay;
            if idx < 0 || idx >= (n_samples as i32 - 1) {
                continue;
            }
            let idx = idx as usize;
            let val = channels_flat[offset + idx] * (1.0 - frac)
                    + channels_flat[offset + idx + 1] * frac;
            output[i] += val;
        }
    }

    let inv = 1.0 / n_channels as f32;
    for v in &mut output {
        *v *= inv;
    }

    output
}
