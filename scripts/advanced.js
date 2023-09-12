
// Following https://surma.dev/things/webgpu/

try {
	if (!navigator.gpu) throw Error("WebGPU not supported.");

	const adapter = await navigator.gpu.requestAdapter();
	if (!adapter) throw Error("Couldn’t request WebGPU adapter.");

	const device = await adapter.requestDevice();
	if (!device) throw Error("Couldn’t request WebGPU logical device.");



	const ctx = document.getElementById('advanced-canvas').getContext('2d');

	function randomBetween(lower, upper) {
		return Math.random() * upper + lower;
	}


	const NUM_BALLS = 32;
	const BUFFER_SIZE = 1000;

	const inputBalls = new Float32Array(new ArrayBuffer(BUFFER_SIZE));
	for (let i = 0; i < NUM_BALLS; i++) {
		inputBalls[i * 6 + 0] = randomBetween(2, 10); // radius
		inputBalls[i * 6 + 1] = 0; // padding
		inputBalls[i * 6 + 2] = randomBetween(0, ctx.canvas.width); // position.x
		inputBalls[i * 6 + 3] = randomBetween(0, ctx.canvas.height); // position.y
		inputBalls[i * 6 + 4] = randomBetween(-100, 100); // velocity.x
		inputBalls[i * 6 + 5] = randomBetween(-100, 100); // velocity.y
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

				@group(0) @binding(0)
				var<storage, read> input: array<Ball>;

				@group(0) @binding(1)
				var<storage, read_write> output: array<Ball>;

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

					output[global_id.x].position =
						input[global_id.x].position +
						input[global_id.x].velocity * TIME_STEP;
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







	function computeFrame() {

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
			const data = copyArrayBuffer.slice(0); // Clone array

			stagingGPUBuffer.unmap();

			// ANOTHER copy? Actually, I don't think it copies it, I think it's just a wrapper
			console.log(new Float32Array(data));

		});
	}



	let lastPerformanceNow = performance.now();
	function run () {
		window.requestAnimationFrame(() => {
			console.log(performance.now() - lastPerformanceNow);

			// Hey ChatGPT, I want to put frame() here, but when I do, it complains about the fact that I apparently
			// can't submit multiple times, plus a mapAsync is already in progress?

			// Also do I need to feed the data back into the ball program?

			lastPerformanceNow = performance.now();
			computeFrame().then(run);
		});
	}

	run();


} catch (e) {
	document.getElementById('errors-advanced').textContent = e;
	throw e;
}