
// Following https://surma.dev/things/webgpu/


const log = (...args) => {
	console.log('basic.js: ', ...args);
}

try {
	if (!navigator.gpu) throw Error("WebGPU not supported.");

	const adapter = await navigator.gpu.requestAdapter();
	if (!adapter) throw Error("Couldn’t request WebGPU adapter.");

	const device = await adapter.requestDevice();
	if (!device) throw Error("Couldn’t request WebGPU logical device.");




	// ------------------------------------------------
	// CREATE BIND GROUP + LAYOUT
	// ------------------------------------------------

	const testOverDispatch = true;

	const workgroupSize = 64;
	// const dispatchXCount = 16;
	const numElements = 1024; // Just happens to be a multiple of workgroupSize for testing

	const numElementsTest = testOverDispatch ? numElements - (workgroupSize + 1) : numElements;

	const BUFFER_SIZE = numElementsTest * Float32Array.BYTES_PER_ELEMENT;
	const bindGroupLayout = device.createBindGroupLayout({
		entries: [{
			binding: 1,
			visibility: GPUShaderStage.COMPUTE,
			buffer: {
				type: "storage",
			},
		}],
	});

	const outputGPUBuffer = device.createBuffer({
		size: BUFFER_SIZE,
		usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
	});

	const bindGroup = device.createBindGroup({
		layout: bindGroupLayout,
		entries: [{
			binding: 1,
			resource: {
				buffer: outputGPUBuffer,
			},
		}],
	});
	// ------------------------------------------------
	// ------------------------------------------------




	// ------------------------------------------------
	// CREATE PIPELINE
	// ------------------------------------------------
	const commandEncoder = device.createCommandEncoder();
	const passEncoder = commandEncoder.beginComputePass();
	const module = device.createShaderModule({
		code: `
			@group(0) @binding(1)
			var<storage, read_write> output: array<f32>;

			@compute @workgroup_size(${workgroupSize})
			fn main(

			@builtin(global_invocation_id)
			global_id : vec3<u32>,

			@builtin(local_invocation_id)
			local_id : vec3<u32>,

			)

			{
				// It seems like WebGPU will automatically not set output values outside the max, at least within
				// the same workgroup.
				if (global_id.x >= ${numElementsTest}) {
					output[global_id.x] = 1.2345;

					// It will run the code though, because you can see the result here:
					// output[0] = 1.2345;

					return;
				}

				output[global_id.x] = f32(global_id.x) * 1000. + f32(local_id.x);
			}
		`,
	});

	const pipeline = device.createComputePipeline({
		layout: device.createPipelineLayout({
			bindGroupLayouts: [bindGroupLayout],
		}),
		compute: {
			module,
			entryPoint: "main",
		},
	});
	passEncoder.setPipeline(pipeline);
	passEncoder.setBindGroup(0, bindGroup);
	const dispatchXCount = Math.ceil(numElements / workgroupSize);
	log({
		dispatchXCount,
		workgroupSize,
		numElements,
		totalWorkItemCount: dispatchXCount * workgroupSize,
	});
	passEncoder.dispatchWorkgroups(dispatchXCount);
	passEncoder.end();
	// ------------------------------------------------
	// ------------------------------------------------




	// ------------------------------------------------
	// STAGING BUFFER AND FINISH PIPELINE
	// ------------------------------------------------
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
	// ------------------------------------------------
	// Why do even need a staging buffer? Try copying output buffer directly
	// ------------------------------------------------




	// ------------------------------------------------
	// START COMPUTE AND COPY
	// ------------------------------------------------
	device.queue.submit([commands]);

	stagingGPUBuffer.mapAsync(
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

		log(new Float32Array(data));
	});

} catch (e) {
	document.getElementById('errors-basic').textContent = e;
	throw e;
}