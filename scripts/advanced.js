
// Following https://surma.dev/things/webgpu/

try {
	if (!navigator.gpu) throw Error("WebGPU not supported.");

	const adapter = await navigator.gpu.requestAdapter();
	if (!adapter) throw Error("Couldn’t request WebGPU adapter.");

	const device = await adapter.requestDevice();
	if (!device) throw Error("Couldn’t request WebGPU logical device.");


	const canvas = document.getElementById('advanced-canvas');
	const ctx = canvas.getContext('2d');

	function randomBetween(lower, upper, label) {
		const range = upper - lower;
		const val = Math.random() * range + lower;

		label = label ? label + ' returning' : 'Returning';

		console.log(label + ` ${val} for lower:${lower}, upper:${upper}`);

		return val;
	}

	const Scene = new Float32Array([canvas.width, canvas.height]);


	const NUM_BALLS = 256;
	const BUFFER_SIZE = 1000;

	let inputBalls = new Float32Array(new ArrayBuffer(BUFFER_SIZE));
	for (let i = 0; i < NUM_BALLS; i++) {
		inputBalls[i * 6 + 0] = randomBetween(2, 10, 'radius');
		inputBalls[i * 6 + 1] = 0; // padding
		inputBalls[i * 6 + 2] = randomBetween(0, ctx.canvas.width, 'position.x');
		inputBalls[i * 6 + 3] = randomBetween(0, ctx.canvas.height, 'position.y');
		inputBalls[i * 6 + 4] = 1.0;randomBetween(-100, 100, 'velocity.x');
		inputBalls[i * 6 + 5] = 1.0;randomBetween(-100, 100, 'velocity.y');
	}


	// ------------------------------------------------
	// CREATE BIND GROUP + LAYOUT
	// ------------------------------------------------

	// Create buffers
	const inputGPUBuffer = device.createBuffer({
		size: BUFFER_SIZE,
		usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
	})

	const outputGPUBuffer = device.createBuffer({
		size: BUFFER_SIZE,
		usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
	});

	// Can use uniform? Or can _just_ use GPUBufferUsage.READ? Easier way to do this lol?
	const sceneGPUBuffer = device.createBuffer({
		size: 2 * Float32Array.BYTES_PER_ELEMENT,
		usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
	});


	// Create bind group + layout
	const bindGroupLayout = device.createBindGroupLayout({
		entries: [
			{
				binding: 0,
				visibility: GPUShaderStage.COMPUTE,
				buffer: {
					type: 'read-only-storage',
				},
			},
			{
				binding: 1,
				visibility: GPUShaderStage.COMPUTE,
				buffer: {
					type: 'storage',
				},
			},
			{
				binding: 2,
				visibility: GPUShaderStage.COMPUTE,
				buffer: {
					type: 'read-only-storage',
				},
			},
		],
	});
	const bindGroup = device.createBindGroup({
		layout: bindGroupLayout,
		entries: [
			{
				binding: 0,
				resource: {
					buffer: inputGPUBuffer,
				}
			},
			{
				binding: 1,
				resource: {
					buffer: outputGPUBuffer,
				},
			},
			{
				binding: 2,
				resource: {
					buffer: sceneGPUBuffer,
				},
			},
		],
	});
	// ------------------------------------------------
	// ------------------------------------------------



	// ------------------------------------------------
	// CREATE PIPELINE
	// ------------------------------------------------
	const entryPointName = 'main';
	const workGroupSize = 64;
	const module = device.createShaderModule({
		code: `
				struct Ball {
					radius: f32,
					position: vec2<f32>,
					velocity: vec2<f32>,
				}

				struct Scene {
					width: f32, // No overloader for u32 x f32?...
					height: f32,
				}

				@group(0) @binding(0)
				var<storage, read> input: array<Ball>;

				@group(0) @binding(1)
				var<storage, read_write> output: array<Ball>;

				@group(0) @binding(2)
				var<storage, read> scene: Scene;

				const TIME_STEP: f32 = 0.016;

				@compute @workgroup_size(${workGroupSize})
				fn ${entryPointName}(

				@builtin(global_invocation_id)
				global_id : vec3<u32>,

				@builtin(local_invocation_id)
				local_id : vec3<u32>,

				)

				{
					let num_balls = arrayLength(&output);
					if(global_id.x >= num_balls) {
						return;
					}

					let gx = global_id.x;

					output[gx] = input[gx];

					output[gx].position = output[gx].position + output[gx].velocity;

					if (output[gx].position.x > scene.width || output[gx].position.x < 0 || output[gx].position.y > scene.width || output[gx].position.y < 0) {
						output[gx].velocity *= -1.0;
					}
				}
			`,
	});

	const pipeline = device.createComputePipeline({
		layout: device.createPipelineLayout({
			bindGroupLayouts: [bindGroupLayout],
		}),
		compute: {
			module,
			entryPoint: entryPointName,
		},
	});






	let lastPerf = 0;
	function computeFrame() {
		const computeFrameStart = performance.now();

		const commandEncoder = device.createCommandEncoder();
		const passEncoder = commandEncoder.beginComputePass();
		passEncoder.setPipeline(pipeline);
		passEncoder.setBindGroup(0, bindGroup);
		passEncoder.dispatchWorkgroups(Math.ceil(BUFFER_SIZE / workGroupSize)); // Math.ceil(1000 / 64) = 16
		passEncoder.end();

		const stagingGPUBuffer = device.createBuffer({
			size: BUFFER_SIZE,
			usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
		});

		commandEncoder.copyBufferToBuffer(
			outputGPUBuffer,
			0, // Source offset
			stagingGPUBuffer,
			0, // Destination offset,
			BUFFER_SIZE
		);
		const commands = commandEncoder.finish();

		device.queue.writeBuffer(inputGPUBuffer, 0, inputBalls);
		device.queue.writeBuffer(sceneGPUBuffer, 0, Scene);
		device.queue.submit([commands]);


		return stagingGPUBuffer.mapAsync(
			GPUMapMode.READ,
			0, // Offset
			BUFFER_SIZE // Length
		).then(() => {

			// https://developer.mozilla.org/en-US/docs/Web/API/GPUBuffer
			// This won't work! Implicit GPU buffer types? Yuck!
			// const copyArrayBuffer = outputGPUBuffer.getMappedRange(0, BUFFER_SIZE);

			const copyArrayBuffer = stagingGPUBuffer.getMappedRange(0, BUFFER_SIZE);


			// Really, another copy? (From tutorial) Don't think this is necessary...
			const newData = copyArrayBuffer.slice(0); // Clone array

			stagingGPUBuffer.unmap();

			const newBalls = new Float32Array(newData);


			// console.log(newBalls);

			// Feedback
			inputBalls = newBalls;

			const computeFrameEnd = performance.now();
			lastPerf = computeFrameEnd - computeFrameStart;
		});
	}



	let lastPerformanceNow = performance.now();
	function run () {
		window.requestAnimationFrame(() => {
			// console.log(performance.now() - lastPerformanceNow);
			document.getElementById('errors-advanced').textContent = lastPerf.toFixed(2) + 'ms';

			// Hey ChatGPT, I want to put frame() here, but when I do, it complains about the fact that I apparently
			// can't submit multiple times, plus a mapAsync is already in progress?

			// Also do I need to feed the data back into the ball program?

			lastPerformanceNow = performance.now();
			computeFrame().then(() => {

				ctx.fillStyle = 'black';
				ctx.fillRect(0, 0, canvas.width, canvas.height);
				ctx.fillStyle = 'white';


				for (let i = 0; i < NUM_BALLS; i ++) {
					const r = inputBalls[i * 6 + 0] / 2;
					const x = inputBalls[i * 6 + 2];
					const y = inputBalls[i * 6 + 3];
					ctx.fillRect(x, y, r, r);
				}

				run();
			});
		});
	}

	run();

	// setInterval(() => {
	// 	computeFrame();
	// }, 1000);


} catch (e) {
	document.getElementById('errors-advanced').textContent = e;
	throw e;
}