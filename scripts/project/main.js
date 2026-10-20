
const WORD_SOUNDS = [
	"0_cami.webm",
	"1_sehir.webm",
	"2_hastane.webm",
	"3_mahalle.webm",
	"4_sokak.webm",
	"5_kutuphane.webm",
	"6_otel.webm",
	"7_okul.webm",
	"8_cadde.webm",
	"9_polis_karakolu.webm",
	"10_lokanta.webm",
	"11_alis_veris_merkezi.webm"
];

const QUESTIONS = [
	{ targetFrame: 0, choices: [3, 7, 0, 2] },
	{ targetFrame: 1, choices: [1, 5, 10, 11] },
	{ targetFrame: 2, choices: [0, 7, 4, 2] },
	{ targetFrame: 3, choices: [3, 1, 11, 9] },
	{ targetFrame: 4, choices: [5, 4, 2, 10] },
	{ targetFrame: 5, choices: [4, 5, 10, 6] },
	{ targetFrame: 6, choices: [0, 7, 6, 3] },
	{ targetFrame: 7, choices: [4, 11, 2, 7] },
	{ targetFrame: 8, choices: [8, 2, 9, 10] },
	{ targetFrame: 9, choices: [8, 9, 2, 0] },
	{ targetFrame: 10, choices: [3, 8, 4, 10] },
	{ targetFrame: 11, choices: [0, 7, 11, 2] }
];
const TOTAL_QUESTIONS = QUESTIONS.length;

const CORRECT_SOUND = "dogru.webm";
const WRONG_SOUND = "hatali.webm";
const QUESTION_LAYOUT = {
	optionBoxes: [
		{ left: 254, top: 406, right: 745, bottom: 497 },
		{ left: 254, top: 518, right: 745, bottom: 609 },
		{ left: 254, top: 631, right: 745, bottom: 722 },
		{ left: 254, top: 743, right: 745, bottom: 834 }
	],
	soundBoxes: [
		{ left: 786, top: 406, right: 945, bottom: 497 },
		{ left: 786, top: 518, right: 945, bottom: 609 },
		{ left: 786, top: 631, right: 945, bottom: 722 },
		{ left: 786, top: 743, right: 945, bottom: 834 }
	]
};
const OPTION_BOX_RADIUS = 17;
const OPTION_TEXT_LEFT_PADDING = 20;
const OPTION_TEXT_HEIGHT = 64;
const QUESTION_COUNTER_CENTERS = {
	total: { x: 88 / 369, y: 81.5 / 162 },
	current: { x: 270.5 / 369, y: 80 / 162 }
};
const WRONG_ANSWER_LOCK_SECONDS = 1;
const CORRECT_ANSWER_LOCK_SECONDS = 1.2;
const BONE_REVEAL_SECONDS = 1.4;
const BUTTON_HOVER_SCALE = 1.04;

const mediaUrlCache = new Map();
const audioChannels = new Map();
const activeEffects = new Map();
const boneEffects = new Map();
let latestAudioRequestId = 0;
let hoveredButtonEffect = null;

const game = {
	questionIndex: -1,
	correctFrame: -1,
	answeredCount: 0,
	acceptingAnswers: false,
	nextQuestionAt: 0,
	finishAt: 0,
	options: [],
	soundButtons: [],
	bones: [],
	questionNumber: null,
	boneBaseStates: new Map(),
	hoveredOption: null,
	optionClickLockedUntil: 0,
	optionBoxes: QUESTION_LAYOUT.optionBoxes
};

runOnStartup(async runtime =>
{
	runtime.addEventListener("beforeprojectstart", () => OnBeforeProjectStart(runtime));
});

function OnBeforeProjectStart(runtime)
{
	runtime.addEventListener("afteranylayoutstart", event => OnLayoutStart(runtime, event.layout));
	runtime.addEventListener("pointerup", event => OnPointerUp(runtime, event));
	runtime.addEventListener("pointermove", event => OnPointerMove(runtime, event));
	runtime.addEventListener("pointercancel", () => ClearButtonHover(runtime));
	runtime.addEventListener("tick", () => Tick(runtime));
}

function OnLayoutStart(runtime, layout)
{
	StopAllAudio();
	ClearEffects();
	ClearBoneEffects();
	hoveredButtonEffect = null;
	SetPointerCursor(runtime, false);

	if (layout.name.toLowerCase() === "oyun")
	{
		layout.getLayer(0).addEventListener("afterdraw", event => DrawHighlights(runtime, event.renderer));
		StartGame(runtime);
	}
}

function StartGame(runtime)
{
	game.questionIndex = -1;
	game.correctFrame = -1;
	game.answeredCount = 0;
	game.acceptingAnswers = false;
	game.nextQuestionAt = 0;
	game.finishAt = 0;
	game.hoveredOption = null;
	game.optionClickLockedUntil = 0;
	game.options = GetInstances(runtime, "secenek").sort((a, b) => a.y - b.y);
	game.soundButtons = GetInstances(runtime, "ses").sort((a, b) => a.y - b.y);
	game.bones = GetInstances(runtime, "kemik").sort((a, b) => a.y - b.y);
	game.questionNumber = SetupQuestionCounter(runtime);
	game.boneBaseStates = new Map();
	game.bones.forEach(bone =>
	{
		game.boneBaseStates.set(bone.uid, {
			width: bone.width,
			height: bone.height,
			color: [...bone.colorRgb],
			blendMode: bone.blendMode
		});
		bone.isVisible = false;
		bone.opacity = 0;
	});

	ShowNextQuestion(runtime);
}

function ShowNextQuestion(runtime)
{
	ClearEffects();
	game.questionIndex++;

	if (game.questionIndex >= TOTAL_QUESTIONS)
	{
		game.acceptingAnswers = false;
		game.finishAt = runtime.wallTime + 3;
		return;
	}

	const question = QUESTIONS[game.questionIndex];
	const targetFrame = question.targetFrame;
	game.correctFrame = targetFrame;

	const target = GetFirstInstance(runtime, "nesne_oyun");
	if (target)
	{
		target.stopAnimation();
		target.animationFrame = targetFrame;
	}

	game.optionBoxes = QUESTION_LAYOUT.optionBoxes;
	const choices = question.choices;

	game.options.forEach((option, index) =>
	{
		option.stopAnimation();
		option.animationFrame = choices[index];
		AlignOptionInBox(option, index, QUESTION_LAYOUT.optionBoxes);
		ResetOptionAppearance(option);
	});

	game.soundButtons.forEach((button, index) =>
		AlignSoundButtonInBox(button, index, QUESTION_LAYOUT.soundBoxes));

	game.acceptingAnswers = true;
	game.nextQuestionAt = 0;
	game.hoveredOption = null;
	game.optionClickLockedUntil = 0;
}

function OnPointerMove(runtime, event)
{
	const layer = runtime.layout.getLayer(0);
	const [x, y] = layer.cssPxToLayer(event.clientX, event.clientY);
	const layoutName = runtime.layout.name.toLowerCase();
	let isInteractive = false;

	if (layoutName === "giris")
	{
		game.hoveredOption = null;
		const hoveredButton = FindButtonAt(runtime,
			["btn_basla", "btn_bilgi", "btn_kaynakca"], x, y);
		SetButtonHover(hoveredButton);
		isInteractive = Boolean(hoveredButton);
	}
	else if (layoutName === "oyun")
	{
		const hoveredOption = game.options.find(option => IsPointInsideOption(option, x, y)) || null;
		const hoveredButton = game.soundButtons.find(button => button.containsPoint(x, y)) || null;
		const canSelectOption = game.acceptingAnswers
			&& runtime.wallTime >= game.optionClickLockedUntil;
		game.hoveredOption = canSelectOption ? hoveredOption : null;
		SetButtonHover(hoveredButton);
		isInteractive = (canSelectOption && Boolean(hoveredOption))
			|| Boolean(hoveredButton);
	}
	else if (layoutName === "bitis" || layoutName === "bilgi" || layoutName === "kaynakca")
	{
		game.hoveredOption = null;
		const hoveredButton = FindButtonAt(runtime, ["ev"], x, y);
		SetButtonHover(hoveredButton);
		isInteractive = Boolean(hoveredButton);
	}
	else
	{
		game.hoveredOption = null;
		SetButtonHover(null);
	}

	SetPointerCursor(runtime, isInteractive);
}

function OnPointerUp(runtime, event)
{
	if (event.pointerType === "mouse" && event.button !== 0)
		return;

	const layer = runtime.layout.getLayer(0);
	const [x, y] = layer.cssPxToLayer(event.clientX, event.clientY);
	const layoutName = runtime.layout.name.toLowerCase();

	if (layoutName === "giris")
	{
		if (ContainsPoint(runtime, "btn_basla", x, y))
		{
			SetButtonHover(null);
			runtime.goToLayout("oyun");
		}
		else if (ContainsPoint(runtime, "btn_bilgi", x, y))
		{
			SetButtonHover(null);
			runtime.goToLayout("bilgi");
		}
		else if (ContainsPoint(runtime, "btn_kaynakca", x, y))
		{
			SetButtonHover(null);
			runtime.goToLayout("kaynakca");
		}

		return;
	}

	if (layoutName === "bitis" || layoutName === "bilgi" || layoutName === "kaynakca")
	{
		if (ContainsPoint(runtime, "ev", x, y))
		{
			SetButtonHover(null);
			runtime.goToLayout("giris");
		}

		return;
	}

	if (layoutName !== "oyun")
		return;

	const soundIndex = game.soundButtons.findIndex(button => button.containsPoint(x, y));
	if (soundIndex !== -1 && game.options[soundIndex])
	{
		const frame = game.options[soundIndex].animationFrame;
		void PlaySound(runtime, WORD_SOUNDS[frame], "word");
		return;
	}

	if (!game.acceptingAnswers || runtime.wallTime < game.optionClickLockedUntil)
		return;

	const selected = game.options.find(option => IsPointInsideOption(option, x, y));
	if (!selected)
		return;

	if (selected.animationFrame === game.correctFrame)
	{
		game.acceptingAnswers = false;
		game.optionClickLockedUntil = runtime.wallTime + CORRECT_ANSWER_LOCK_SECONDS;
		game.answeredCount++;
		SetQuestionNumber(Math.min(game.answeredCount + 1, TOTAL_QUESTIONS));
		AwardBone(game.answeredCount - 1, runtime.wallTime);
		StartEffect(selected, "correct", runtime.wallTime, CORRECT_ANSWER_LOCK_SECONDS);
		void PlaySound(runtime, CORRECT_SOUND, "feedback");

		if (game.answeredCount >= TOTAL_QUESTIONS)
			game.finishAt = runtime.wallTime + 3;
		else
			game.nextQuestionAt = runtime.wallTime + CORRECT_ANSWER_LOCK_SECONDS;
	}
	else
	{
		game.optionClickLockedUntil = runtime.wallTime + WRONG_ANSWER_LOCK_SECONDS;
		game.hoveredOption = null;
		StartEffect(selected, "wrong", runtime.wallTime, WRONG_ANSWER_LOCK_SECONDS);
		void PlaySound(runtime, WRONG_SOUND, "feedback");
	}
}

function Tick(runtime)
{
	UpdateEffects(runtime.wallTime);
	UpdateBoneEffects(runtime.wallTime);

	if (runtime.layout.name.toLowerCase() !== "oyun")
		return;

	if (game.finishAt > 0 && runtime.wallTime >= game.finishAt)
	{
		game.finishAt = 0;
		SetButtonHover(null);
		runtime.goToLayout("bitis");
		return;
	}

	if (game.nextQuestionAt > 0 && runtime.wallTime >= game.nextQuestionAt)
		ShowNextQuestion(runtime);
}

function StartEffect(instance, type, now, duration)
{
	const existing = activeEffects.get(instance.uid);
	if (existing)
		RestoreEffect(existing);

	const effect = {
		instance,
		type,
		start: now,
		end: now + duration,
		width: instance.width,
		height: instance.height,
		color: [...instance.colorRgb],
		opacity: instance.opacity,
		blendMode: instance.blendMode
	};

	activeEffects.set(instance.uid, effect);
	instance.blendMode = "normal";
	instance.opacity = 1;
	instance.colorRgb = [1, 1, 1];
}

function UpdateEffects(now)
{
	for (const [uid, effect] of activeEffects)
	{
		if (now >= effect.end)
		{
			RestoreEffect(effect);
			activeEffects.delete(uid);
			continue;
		}

		const progress = (now - effect.start) / (effect.end - effect.start);
		const pulse = Math.sin(progress * Math.PI * 4);
		const scale = 1 + 0.035 * Math.abs(pulse);

		effect.instance.width = effect.width * scale;
		effect.instance.height = effect.height * scale;
		effect.instance.opacity = 1;
		effect.instance.blendMode = "normal";
		effect.instance.colorRgb = [1, 1, 1];
	}
}

function DrawHighlights(runtime, renderer)
{
	for (const effect of boneEffects.values())
	{
		const progress = Math.max(0, Math.min(1,
			(runtime.wallTime - effect.start) / (effect.end - effect.start)
		));
		const intensity = (1 - progress) * 0.65
			+ 0.55
			+ 0.25 * Math.abs(Math.sin(progress * Math.PI * 6));
		DrawBoneGlow(renderer, effect.instance, intensity);
	}

	for (const effect of activeEffects.values())
	{
		const progress = Math.max(0, Math.min(1,
			(runtime.wallTime - effect.start) / (effect.end - effect.start)
		));
		const intensity = 0.75 + 0.25 * Math.abs(Math.sin(progress * Math.PI * 5));
		DrawOptionGlow(renderer, effect.instance, effect.type, intensity);
	}

	if (game.hoveredOption && !activeEffects.has(game.hoveredOption.uid))
		DrawOptionGlow(renderer, game.hoveredOption, "hover", 0.75);
}

function DrawOptionGlow(renderer, option, type, intensity)
{
	const rgb = type === "correct"
		? [0.05, 1, 0.12]
		: type === "wrong"
			? [1, 0.04, 0.04]
			: [0.1, 0.55, 1];
	const box = GetOptionBox(option);
	const { left, top, right, bottom } = box;

	renderer.setBlendMode("normal");
	renderer.setCurrentZ(0);
	renderer.setColorFillMode();

	for (let ring = 3; ring >= 1; ring--)
	{
		const padding = 8 + ring * 9;
		const alpha = (0.035 + (4 - ring) * 0.025) * intensity;
		DrawRoundedRect(
			renderer,
			left - padding,
			top - padding,
			right + padding,
			bottom + padding,
			OPTION_BOX_RADIUS + padding,
			rgb,
			alpha
		);
	}

	const fillAlpha = (type === "hover" ? 0.18 : 0.42) * intensity;
	DrawRoundedRect(renderer, left, top, right, bottom, OPTION_BOX_RADIUS, rgb, fillAlpha);
	renderer.resetColor();
}

function DrawBoneGlow(renderer, bone, intensity)
{
	const halfWidth = Math.abs(bone.width) / 2;
	const halfHeight = Math.abs(bone.height) / 2;
	const rgb = [1, 0.76, 0.08];

	renderer.setBlendMode("normal");
	renderer.setCurrentZ(0);
	renderer.setColorFillMode();

	for (let ring = 4; ring >= 1; ring--)
	{
		const padding = 5 + ring * 7;
		const alpha = (0.025 + (5 - ring) * 0.025) * intensity;
		DrawRoundedRect(
			renderer,
			bone.x - halfWidth - padding,
			bone.y - halfHeight - padding,
			bone.x + halfWidth + padding,
			bone.y + halfHeight + padding,
			halfHeight + padding,
			rgb,
			alpha
		);
	}

	renderer.resetColor();
}

function DrawRoundedRect(renderer, left, top, right, bottom, radius, rgb, alpha)
{
	const safeRadius = Math.min(radius, (right - left) / 2, (bottom - top) / 2);
	const centerY = (top + bottom) / 2;
	const halfHeight = (bottom - top) / 2;
	const stripHeight = 2;

	renderer.setColor([rgb[0] * alpha, rgb[1] * alpha, rgb[2] * alpha, alpha]);

	for (let y = top; y < bottom; y += stripHeight)
	{
		const stripBottom = Math.min(y + stripHeight, bottom);
		const stripCenterY = (y + stripBottom) / 2;
		const distanceFromCenter = Math.abs(stripCenterY - centerY);
		let inset = 0;

		if (distanceFromCenter > halfHeight - safeRadius)
		{
			const circleY = distanceFromCenter - (halfHeight - safeRadius);
			inset = safeRadius - Math.sqrt(Math.max(0, safeRadius * safeRadius - circleY * circleY));
		}

		renderer.rect2(left + inset, y, right - inset, stripBottom);
	}
}

function ClearEffects()
{
	for (const effect of activeEffects.values())
		RestoreEffect(effect);

	activeEffects.clear();
}

function AwardBone(index, now)
{
	const bone = game.bones[index];
	if (!bone)
		return;

	const base = game.boneBaseStates.get(bone.uid);
	if (!base)
		return;

	bone.isVisible = true;
	bone.opacity = 0;
	bone.width = base.width * 0.45;
	bone.height = base.height * 0.45;
	bone.colorRgb = [1, 1, 1];
	bone.blendMode = "normal";

	boneEffects.set(bone.uid, {
		instance: bone,
		start: now,
		end: now + BONE_REVEAL_SECONDS,
		base
	});
}

function UpdateBoneEffects(now)
{
	for (const [uid, effect] of boneEffects)
	{
		if (now >= effect.end)
		{
			RestoreBoneEffect(effect);
			boneEffects.delete(uid);
			continue;
		}

		const progress = Math.max(0, Math.min(1,
			(now - effect.start) / (effect.end - effect.start)
		));
		const entranceProgress = Math.min(progress / 0.45, 1);
		const easeOut = 1 - Math.pow(1 - entranceProgress, 3);
		const pulse = Math.abs(Math.sin(progress * Math.PI * 5)) * 0.08 * (1 - progress);
		const scale = 0.45 + 0.55 * easeOut + pulse;

		effect.instance.isVisible = true;
		effect.instance.opacity = Math.min(1, entranceProgress * 1.8);
		effect.instance.width = effect.base.width * scale;
		effect.instance.height = effect.base.height * scale;
		effect.instance.colorRgb = [1, 1, 1];
		effect.instance.blendMode = "normal";
	}
}

function ClearBoneEffects()
{
	for (const effect of boneEffects.values())
		RestoreBoneEffect(effect);

	boneEffects.clear();
}

function RestoreBoneEffect(effect)
{
	const { instance, base } = effect;
	instance.isVisible = true;
	instance.opacity = 1;
	instance.width = base.width;
	instance.height = base.height;
	instance.colorRgb = [...base.color];
	instance.blendMode = base.blendMode;
}

function RestoreEffect(effect)
{
	const { instance } = effect;
	instance.width = effect.width;
	instance.height = effect.height;
	instance.colorRgb = effect.color;
	instance.opacity = effect.opacity;
	instance.blendMode = effect.blendMode;
}

function ResetOptionAppearance(option)
{
	option.colorRgb = [1, 1, 1];
	option.opacity = 1;
	option.blendMode = "normal";
}

function SetupQuestionCounter(runtime)
{
	const counterParts = GetInstances(runtime, "sorusayisi").sort((a, b) => a.x - b.x);
	counterParts.forEach(part => part.stopAnimation());

	const totalQuestions = counterParts[0] || null;
	const counterBackground = counterParts.length >= 3 ? counterParts[1] : null;
	const currentQuestion = counterParts.length >= 2
		? counterParts[counterParts.length - 1]
		: null;

	if (counterBackground)
	{
		counterBackground.animationFrame = 0;
		AlignQuestionCounterPart(totalQuestions, counterBackground,
			QUESTION_COUNTER_CENTERS.total);
		AlignQuestionCounterPart(currentQuestion, counterBackground,
			QUESTION_COUNTER_CENTERS.current);
	}

	if (totalQuestions)
		totalQuestions.animationFrame = 1;

	if (currentQuestion)
		currentQuestion.animationFrame = TOTAL_QUESTIONS;

	return currentQuestion;
}

function AlignQuestionCounterPart(part, background, normalizedCenter)
{
	if (!part || !background)
		return;

	part.x = background.x + (normalizedCenter.x - 0.5) * background.width;
	part.y = background.y + (normalizedCenter.y - 0.5) * background.height;
}

function SetQuestionNumber(questionNumber)
{
	if (!game.questionNumber)
		return;

	const safeQuestionNumber = Math.max(1,
		Math.min(questionNumber, TOTAL_QUESTIONS));

	game.questionNumber.stopAnimation();
	game.questionNumber.animationFrame = TOTAL_QUESTIONS - safeQuestionNumber + 1;
}

function AlignOptionInBox(option, index, optionBoxes)
{
	const box = optionBoxes[index];
	if (!box)
		return;

	const sourceWidth = option.imageWidth || option.width;
	const sourceHeight = option.imageHeight || option.height;
	const scale = OPTION_TEXT_HEIGHT / sourceHeight;

	option.width = sourceWidth * scale;
	option.height = OPTION_TEXT_HEIGHT;
	option.x = box.left + OPTION_TEXT_LEFT_PADDING + option.width / 2;
	option.y = (box.top + box.bottom) / 2;
}

function AlignSoundButtonInBox(button, index, soundBoxes)
{
	const box = soundBoxes[index];
	if (!box)
		return;

	button.x = (box.left + box.right) / 2;
	button.y = (box.top + box.bottom) / 2;
}

async function PlaySound(runtime, fileName, channel)
{
	const requestId = ++latestAudioRequestId;

	try
	{
		let url = mediaUrlCache.get(fileName);
		if (!url)
		{
			url = await runtime.assets.getMediaFileUrl(fileName);
			mediaUrlCache.set(fileName, url);
		}

		if (requestId !== latestAudioRequestId)
			return;

		StopPlayingAudio();

		const audio = new globalThis.Audio(url);
		audio.preload = "auto";
		audioChannels.set(channel, audio);
		await audio.play();
	}
	catch (error)
	{
		console.warn(`Ses çalınamadı: ${fileName}`, error);
	}
}

function StopAllAudio()
{
	latestAudioRequestId++;
	StopPlayingAudio();
}

function StopPlayingAudio()
{
	for (const audio of audioChannels.values())
	{
		audio.pause();
		audio.currentTime = 0;
	}

	audioChannels.clear();
}

function GetInstances(runtime, objectName)
{
	const objectClass = runtime.objects[objectName];
	return objectClass ? objectClass.getAllInstances() : [];
}

function GetFirstInstance(runtime, objectName)
{
	const objectClass = runtime.objects[objectName];
	return objectClass ? objectClass.getFirstInstance() : null;
}

function ContainsPoint(runtime, objectName, x, y)
{
	const instance = GetFirstInstance(runtime, objectName);
	return instance ? instance.containsPoint(x, y) : false;
}

function FindButtonAt(runtime, objectNames, x, y)
{
	for (const objectName of objectNames)
	{
		const instance = GetFirstInstance(runtime, objectName);
		if (instance && instance.containsPoint(x, y))
			return instance;
	}

	return null;
}

function SetButtonHover(button)
{
	if (hoveredButtonEffect && hoveredButtonEffect.instance === button)
		return;

	if (hoveredButtonEffect)
	{
		hoveredButtonEffect.instance.width = hoveredButtonEffect.width;
		hoveredButtonEffect.instance.height = hoveredButtonEffect.height;
		hoveredButtonEffect = null;
	}

	if (!button)
		return;

	hoveredButtonEffect = {
		instance: button,
		width: button.width,
		height: button.height
	};
	button.width = hoveredButtonEffect.width * BUTTON_HOVER_SCALE;
	button.height = hoveredButtonEffect.height * BUTTON_HOVER_SCALE;
}

function ClearButtonHover(runtime)
{
	SetButtonHover(null);
	game.hoveredOption = null;
	SetPointerCursor(runtime, false);
}

function SetPointerCursor(runtime, isInteractive)
{
	if (runtime.mouse)
		runtime.mouse.setCursorStyle(isInteractive ? "pointer" : "default");
}

function IsPointInsideOption(option, x, y)
{
	const { left, top, right, bottom } = GetOptionBox(option);
	return x >= left && x <= right && y >= top && y <= bottom;
}

function GetOptionBox(option)
{
	const index = game.options.indexOf(option);
	return game.optionBoxes[index] || {
		left: option.x - Math.abs(option.width) / 2,
		top: option.y - Math.abs(option.height) / 2,
		right: option.x + Math.abs(option.width) / 2,
		bottom: option.y + Math.abs(option.height) / 2
	};
}

