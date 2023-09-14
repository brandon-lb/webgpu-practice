
// Following https://surma.dev/things/webgpu/



const log = (...args) => {
	console.log('advanced.js: ', ...args);
}

const canvasEl = document.getElementById('advanced-canvas');
const outputEl = document.getElementById('errors-advanced');

try {
	if (!navigator.gpu) throw Error("WebGPU not supported.");

	const adapter = await navigator.gpu.requestAdapter();
	if (!adapter) throw Error("Couldn’t request WebGPU adapter.");

	const device = await adapter.requestDevice();
	if (!device) throw Error("Couldn’t request WebGPU logical device.");


	window.adapter = adapter;
	window.device = device;


	const ctx = canvasEl.getContext('2d');

	canvasEl.width = document.body.clientWidth;
	canvasEl.height = document.body.clientHeight;

	const SceneData = new Float32Array([canvasEl.width, canvasEl.height]);

	function randomBetween(lower, upper, label) {
		const range = upper - lower;
		const val = Math.random() * range + lower;

		label = label ? label + ' returning' : 'Returning';

		// log(label + ` ${val} for lower:${lower}, upper:${upper}`);

		return val;
	}

	const NUM_BALLS = 32;
	const BUFFER_SIZE = NUM_BALLS * 6 * Float32Array.BYTES_PER_ELEMENT;

	const workGroupDimensions = [16, 1, 1];

	const workgroupCountX = 2;//Math.ceil(NUM_BALLS / workGroupDimensions[0]);
	const workgroupCountY = 1;
	const workgroupCountZ = 1;
	log({ workgroupCountX, workgroupCountY, workgroupCountZ })


	log('Buffer size: ' + BUFFER_SIZE);

	let inputBalls = new Float32Array(new ArrayBuffer(BUFFER_SIZE));
	for (let i = 0; i < NUM_BALLS; i++) {
		inputBalls[i * 6 + 0] = 5;
		inputBalls[i * 6 + 1] = 0; // padding
		inputBalls[i * 6 + 2] = randomBetween(0, ctx.canvas.width, 'position.x');
		inputBalls[i * 6 + 3] = randomBetween(0, ctx.canvas.height, 'position.y');
		inputBalls[i * 6 + 4] = randomBetween(-1, 1, 'velocity.x');
		inputBalls[i * 6 + 5] = randomBetween(-1, 1, 'velocity.y');
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

	// Can use uniform? Easier way to do this lol?
	const sceneGPUBuffer = device.createBuffer({
		size: 2 * Float32Array.BYTES_PER_ELEMENT,
		usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
	});

	const stagingGPUBuffer = device.createBuffer({
		size: BUFFER_SIZE,
		usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
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

	// Info:
	// device.limits
	// maxComputeInvocationsPerWorkgroup: 256,
	// maxComputeWorkgroupSizeX: 256,
  	// maxComputeWorkgroupSizeY: 256,
  	// maxComputeWorkgroupSizeZ: 64,
  	// maxComputeWorkgroupsPerDimension: 65535,

	const entryPointName = 'main';
	const shaderModule = device.createShaderModule({
		code: `
				struct Ball {
					radius: f32,
					position: vec2<f32>,
					velocity: vec2<f32>,
				}

				struct Scene {
					width: f32, // No overloader for u32 x f32?... And no u16?
					height: f32,
				}

				@group(0) @binding(0)
				var<storage, read> input: array<Ball>;

				@group(0) @binding(1)
				var<storage, read_write> output: array<Ball>;

				@group(0) @binding(2)
				var<storage, read> scene: Scene;

				const TIME_STEP: f32 = 0.016;

				@compute @workgroup_size(${workGroupDimensions.toString()})
				fn ${entryPointName}(

				@builtin(global_invocation_id)
				global_id : vec3<u32>,

				@builtin(local_invocation_id)
				local_id : vec3<u32>,

				)


				// Key takeaway here is that is like a compute fragment shader. We're not using a loop, all of these
				// invocations are in parallel (I believe).
				{
					let num_balls = arrayLength(&output);
					if(global_id.x >= num_balls) {
						// Overdispatched!
						// Set position to static in the center, so we know something is wrong

						// Loop and set every element to the center
						for (var i = 0u; i < num_balls; i = i + 1u) {
							// output[i].position = vec2<f32>(scene.width / 2.0, scene.height / 2.0);
							output[i].position = vec2<f32>(64.0, 64.0);
						}

						// This tame version only seems to be noticeable when you dispatch an absurdly disproportionate
						// amount of workgroups.
						// output[0].position = vec2<f32>(scene.width / 2.0, scene.height / 2.0);
						return;
					}


					// Actual normal logic

					let gx = global_id.x;

					output[gx] = input[gx];

					output[gx].position = output[gx].position + output[gx].velocity;

					if (output[gx].position.x > scene.width || output[gx].position.x < 0) {
						output[gx].velocity.x *= -1.0;
					}

					if (output[gx].position.y > scene.height || output[gx].position.y < 0) {
						output[gx].velocity.y *= -1.0;
					}
				}
			`,
	});

	const pipeline = device.createComputePipeline({
		layout: device.createPipelineLayout({
			bindGroupLayouts: [bindGroupLayout],
		}),
		compute: {
			module: shaderModule,
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


		passEncoder.dispatchWorkgroups(workgroupCountX, workgroupCountY, workgroupCountZ);
		passEncoder.end();

		commandEncoder.copyBufferToBuffer(
			outputGPUBuffer, 0, // Source offset
			stagingGPUBuffer, 0, // Destination offset,
			BUFFER_SIZE
		);

		const commands = commandEncoder.finish();

		device.queue.writeBuffer(sceneGPUBuffer, 0, SceneData);
		device.queue.writeBuffer(inputGPUBuffer, 0, inputBalls);
		device.queue.submit([commands]);

		stagingGPUBuffer.mapAsync(
			GPUMapMode.READ,
			0, // Offset
			BUFFER_SIZE // Length
		);


		return device.queue.onSubmittedWorkDone().then(() => {

			const mapAsyncPromiseResolved = performance.now();

			// log('mapAsync took ' + (mapAsyncPromiseResolved - computeFrameStart).toFixed(2) + 'ms');


			// https://developer.mozilla.org/en-US/docs/Web/API/GPUBuffer
			// This won't work! Implicit GPU buffer types? Yuck!
			// const copyArrayBuffer = outputGPUBuffer.getMappedRange(0, BUFFER_SIZE);

			const copyArrayBuffer = stagingGPUBuffer.getMappedRange(0, BUFFER_SIZE);


			// Really, another copy? (From tutorial) Don't think this is necessary...
			const newData = copyArrayBuffer.slice(0); // Clone array

			stagingGPUBuffer.unmap();

			const newBalls = new Float32Array(newData);


			// log(newBalls);

			// Feedback
			inputBalls = newBalls;

			const computeFrameEnd = performance.now();

		});
	}



	let lastPerformanceNow = performance.now();
	function run () {
		window.requestAnimationFrame(() => {
			// log(performance.now() - lastPerformanceNow);
			outputEl.textContent = lastPerf.toFixed(2) + 'ms';

			// Hey ChatGPT, I want to put frame() here, but when I do, it complains about the fact that I apparently
			// can't submit multiple times, plus a mapAsync is already in progress?

			// Also do I need to feed the data back into the ball program?

			lastPerformanceNow = performance.now();
			computeFrame().then(() => {

				ctx.fillStyle = 'black';
				ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);
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

} catch (e) {
	outputEl.textContent = e;
	throw e;
}