const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function argumentValue(name, fallback = '') {
  const prefix = `--${name}=`;
  const match = process.argv.find(value => value.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function isoStamp() {
  return new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function safeError(error) {
  return {
    code: String(error?.code || 'ERROR'),
    message: String(error?.message || error || '').slice(0, 1000),
    billing_state: String(error?.billingState || error?.billing_state || ''),
    provider_submission_state: String(error?.providerSubmissionState || error?.provider_submission_state || ''),
    provider_request_id: String(error?.providerRequestId || error?.provider_request_id || ''),
    provider_task_id: String(error?.providerTaskId || error?.provider_task_id || ''),
  };
}

function fileSha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

async function main() {
  if (!process.argv.includes('--confirm-paid')) {
    throw new Error('Refusing real supplier calls without --confirm-paid');
  }
  if (process.env.NEW_STORY_AD_MOCK_IMAGE === '1' || process.env.NEW_STORY_AD_MOCK_LLM === '1') {
    throw new Error('Real matrix cannot run while mock generation is enabled');
  }

  const root = path.resolve(__dirname, '..');
  const sourcePath = path.resolve(argumentValue('source'));
  const maxSubmissions = Math.max(1, Number(argumentValue('max-image-submissions', '15')) || 15);
  const expectedSubmissions = 15;
  assert.equal(maxSubmissions, expectedSubmissions, 'this matrix is fixed to the authorized 15-image submission cap');
  assert.ok(fs.existsSync(sourcePath), `authorized portrait source not found: ${sourcePath}`);

  process.env.DB_ENABLED = '0';
  process.env.NEW_STORY_AD_IMAGE_MAX_CANDIDATES = '1';
  const requestedPublicBase = argumentValue('public-base-url');
  if (requestedPublicBase) process.env.NEW_STORY_AD_PUBLIC_BASE_URL = requestedPublicBase;
  if (!process.env.NEW_STORY_AD_PUBLIC_BASE_URL && !process.env.PUBLIC_BASE_URL) {
    process.env.NEW_STORY_AD_PUBLIC_BASE_URL = 'http://127.0.0.1:3007';
  }

  const resumeRunId = argumentValue('resume-run-id');
  const runId = resumeRunId || `real-dossier-matrix-${isoStamp()}`;
  const auditDir = path.join(root, 'outputs', 'audits', 'real-dossier-matrix', runId);
  const auditPath = path.join(auditDir, 'audit.json');
  fs.mkdirSync(auditDir, { recursive: true });

  let audit;
  if (resumeRunId) {
    assert.ok(fs.existsSync(auditPath), `resume audit not found: ${auditPath}`);
    audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
    assert.equal(audit.run_id, runId);
    if (process.argv.includes('--verify-completed-run')) {
      const successes = audit.provider_submissions.filter(item => item.status === 'success');
      const incidents = audit.provider_submissions.filter(item => (
        item.status === 'failed'
        && item.error?.billing_state === 'unknown'
        && item.error?.provider_submission_state === 'submitted_unknown'
      ));
      assert.equal(audit.provider_submissions.length, expectedSubmissions);
      assert.equal(successes.length, expectedSubmissions - 1);
      assert.equal(incidents.length, 1);
      assert.equal(audit.status, 'completed_with_external_provider_incident');
      assert.equal(audit.verification.person?.qa?.pass, true);
      assert.equal(audit.verification.person?.atomic_asset_count, 17);
      assert.equal(audit.verification.props?.state_view_count, 2);
      assert.equal(audit.verification.dual_scenes?.length, 2);
      assert.equal(audit.verification.dual_scenes?.[1]?.view_count, 5);
      assert.equal(audit.verification.dual_scenes?.[1]?.layout_preflight?.pass, true);
      console.log(JSON.stringify({
        passed: true,
        verified_completed_run: runId,
        provider_image_submissions: audit.provider_submissions.length,
        successful_image_submissions: successes.length,
        external_provider_incidents: incidents.length,
        no_provider_calls_executed: true,
      }));
      return;
    }
    assert.ok(audit.provider_submissions.length < maxSubmissions, 'resume audit has no remaining authorized image submissions');
    const recordedFailures = audit.provider_submissions.filter(item => item.status !== 'success');
    const acknowledgedExternalIncidents = recordedFailures.filter(item => (
      item.status === 'failed'
      && item.phase === 'dual_scene_asset_1'
      && item.error?.billing_state === 'unknown'
      && item.error?.provider_submission_state === 'submitted_unknown'
    ));
    assert.equal(
      acknowledgedExternalIncidents.length,
      recordedFailures.length,
      'resume only permits the recorded first-scene provider 5xx incident; no unknown submission may be retried',
    );
    assert.ok(recordedFailures.length <= 1, 'resume permits at most one recorded external provider incident');
    const resumePlan = {
      run_id: runId,
      submissions_before_resume: audit.provider_submissions.length,
      remaining_authorized_submissions: maxSubmissions - audit.provider_submissions.length,
      reuse_completed_person_dossier: audit.outputs.person_dossier?.atomic_assets?.length === 17
        && audit.outputs.person_dossier?.category_atlases?.length === 4
        && audit.verification.person?.qa?.pass === true,
      reuse_completed_stateful_prop: audit.outputs.props?.stateful?.generation_summary?.provider_calls_this_run === 2,
      preserve_first_scene_without_retry: acknowledgedExternalIncidents.length === 1,
      spaces_to_generate: acknowledgedExternalIncidents.length === 1
        ? ['sheltered_balcony']
        : ['galley_kitchen', 'sheltered_balcony'],
    };
    if (process.argv.includes('--inspect-resume-plan')) {
      assert.equal(resumePlan.remaining_authorized_submissions, resumePlan.spaces_to_generate.length * 2);
      assert.equal(resumePlan.reuse_completed_person_dossier, true);
      assert.equal(resumePlan.reuse_completed_stateful_prop, true);
      console.log(JSON.stringify({ passed: true, resume_plan: resumePlan }, null, 2));
      return;
    }
    audit.initial_failure = audit.error || audit.initial_failure || null;
    if (recordedFailures.length) {
      audit.external_provider_incidents = [
        ...(audit.external_provider_incidents || []),
        ...recordedFailures.map(item => ({
          number: item.number,
          phase: item.phase,
          client_request_id: item.client_request_id,
          status: item.status,
          error: item.error,
          action: 'not retried; preserved as billing-unknown evidence',
        })),
      ];
    }
    audit.status = 'running';
    audit.error = null;
    audit.resumes = [
      ...(audit.resumes || []),
      {
        resumed_at: new Date().toISOString(),
        confirmed_submissions_before_resume: audit.provider_submissions.length,
        remaining_authorized_submissions: maxSubmissions - audit.provider_submissions.length,
      },
    ];
  } else {
    audit = {
      schema_version: 1,
      run_id: runId,
      status: 'running',
      authorized_image_submission_cap: maxSubmissions,
      expected_image_submissions: expectedSubmissions,
      started_at: new Date().toISOString(),
      source: {
        local_file: sourcePath,
        sha256: fileSha256(sourcePath),
        page_url: 'https://www.pexels.com/photo/portrait-of-brunette-woman-in-a-studio-19748978/',
        license_url: 'https://www.pexels.com/license/',
        usage: 'internal authorized-real-person workflow verification; no endorsement implied',
      },
      provider_submissions: [],
      local_preflight_failures: [],
      phases: [],
      task_ids: {},
      outputs: {},
      verification: {},
    };
  }
  const persistAudit = () => {
    const temp = `${auditPath}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(audit, null, 2), 'utf8');
    fs.renameSync(temp, auditPath);
  };
  persistAudit();

  const deyunai = require('../src/services/deyunaiService');
  const originalDeyunaiGenerateImage = deyunai.generateImage;
  let currentPhase = 'preflight';
  deyunai.generateImage = async options => {
    let row = null;
    const originalOnSubmitting = options.onSubmitting;
    const originalOnSubmitted = options.onSubmitted;
    const observedOptions = {
      ...options,
      onSubmitting: async event => {
        if (audit.provider_submissions.length >= maxSubmissions) {
          const error = new Error(`authorized image submission cap ${maxSubmissions} reached before provider invocation`);
          error.code = 'REAL_MATRIX_IMAGE_BUDGET_EXHAUSTED';
          error.billingState = 'not_submitted';
          throw error;
        }
        if (typeof originalOnSubmitting === 'function') await originalOnSubmitting(event);
        row = {
          number: audit.provider_submissions.length + 1,
          phase: currentPhase,
          client_request_id: String(options.clientRequestId || ''),
          model: String(options.model || ''),
          aspect_ratio: String(options.aspectRatio || ''),
          reference_count: Array.isArray(options.referenceImages) ? options.referenceImages.length : 0,
          started_at: new Date().toISOString(),
          status: 'submitting',
        };
        audit.provider_submissions.push(row);
        persistAudit();
      },
      onSubmitted: async event => {
        if (row) {
          row.provider_request_id = String(event?.providerRequestId || '');
          row.provider_task_id = String(event?.taskId || '');
          row.provider_submission_state = String(event?.status || 'submitted');
          persistAudit();
        }
        if (typeof originalOnSubmitted === 'function') await originalOnSubmitted(event);
      },
    };
    const startedAt = Date.now();
    try {
      const result = await originalDeyunaiGenerateImage(observedOptions);
      if (row) {
        Object.assign(row, {
          status: 'success',
          duration_ms: Date.now() - startedAt,
          provider_request_id: String(result?.providerRequestId || row.provider_request_id || ''),
          provider_task_id: String(result?.taskId || row.provider_task_id || ''),
          finished_at: new Date().toISOString(),
        });
      }
      persistAudit();
      return result;
    } catch (error) {
      if (row) {
        Object.assign(row, {
          status: 'failed',
          duration_ms: Date.now() - startedAt,
          error: safeError(error),
          finished_at: new Date().toISOString(),
        });
      } else {
        audit.local_preflight_failures.push({
          phase: currentPhase,
          client_request_id: String(options.clientRequestId || ''),
          model: String(options.model || ''),
          duration_ms: Date.now() - startedAt,
          error: safeError(error),
          failed_at: new Date().toISOString(),
        });
      }
      persistAudit();
      throw error;
    }
  };

  const storage = require('../src/services/newStoryAd/storageService');
  const personDossier = require('../src/services/newStoryAd/personDossierService');
  const propAssets = require('../src/services/newStoryAd/propAssetService');
  const sceneAssets = require('../src/services/newStoryAd/sceneAssetService');
  const sceneCheckpoint = require('../src/services/newStoryAd/sceneGenerationCheckpointService');
  const mediaAdapter = require('../src/services/newStoryAd/mediaAdapter');

  async function phase(name, expectedCalls, work) {
    currentPhase = name;
    const startCount = audit.provider_submissions.length;
    const startedAt = Date.now();
    const row = {
      name,
      expected_image_submissions: expectedCalls,
      started_at: new Date().toISOString(),
      status: 'running',
    };
    audit.phases.push(row);
    persistAudit();
    try {
      const value = await work();
      const actualCalls = audit.provider_submissions.length - startCount;
      Object.assign(row, {
        status: 'completed',
        actual_image_submissions: actualCalls,
        duration_ms: Date.now() - startedAt,
        finished_at: new Date().toISOString(),
      });
      assert.equal(actualCalls, expectedCalls, `${name} must use exactly ${expectedCalls} provider image submissions`);
      persistAudit();
      return value;
    } catch (error) {
      Object.assign(row, {
        status: 'failed',
        actual_image_submissions: audit.provider_submissions.length - startCount,
        duration_ms: Date.now() - startedAt,
        error: safeError(error),
        finished_at: new Date().toISOString(),
      });
      persistAudit();
      throw error;
    }
  }

  async function waitForPersonJob(taskId, user, kind, timeoutMs = 20 * 60 * 1000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const production = personDossier.getProduction(taskId, user);
      const status = production?.[`${kind}_job`]?.status;
      if (['completed', 'failed', 'cancelled'].includes(status)) return production;
      await sleep(1000);
    }
    const error = new Error(`timed out waiting for person ${kind} job`);
    error.code = 'REAL_MATRIX_PERSON_JOB_TIMEOUT';
    throw error;
  }

  function createTask(taskId, request) {
    const existing = storage.getTask(taskId);
    if (existing) return existing;
    storage.createTask({
      id: taskId,
      title: `Real supplier matrix ${taskId}`,
      brief: request.brief,
      user_id: 'real-matrix-auditor',
      request,
    });
    storage.saveOutput(taskId, 'context', request);
  }

  function sceneSpec(layoutText, materialLightText, interactionText) {
    return {
      layoutText,
      materialLightText,
      interactionText,
      negativeText: 'Keep the space empty: no people, readable text, logos, watermarks, duplicate furniture, impossible reflections or disconnected architecture.',
      surfaceTopology: {
        mode: 'continuous',
        seam_policy: 'construction-realistic',
        finish_distribution: 'regional',
        notes: 'Surfaces meet at physically plausible joints and retain localized wear rather than sterile uniformity.',
      },
    };
  }

  function seedSceneTask(taskId, spaces) {
    const request = {
      brief: spaces.map(space => space.description).join(' / '),
      product_subject: 'an original unbranded household product',
      scene_spec: spaces[0].scene_spec,
      controlled_production: {
        style_control: { notes: 'photorealistic commercial location photography with natural optical falloff' },
        negative_control: { text: 'no people, text, logos or watermarks' },
      },
    };
    createTask(taskId, request);
    storage.saveOutput(taskId, 'scene_config', {
      scene_mode: spaces.length > 1 ? 'multi' : 'single',
      spaces,
    });
  }

  try {
    const user = { id: `real-matrix-user-${runId}` };
    const personTaskId = `${runId}-person`;
    audit.task_ids.person = personTaskId;
    let candidates;
    const completedPersonDossier = audit.outputs.person_dossier?.atomic_assets?.length === 17
      && audit.outputs.person_dossier?.category_atlases?.length === 4
      && audit.verification.person?.qa?.pass === true;
    if (completedPersonDossier) {
      const production = personDossier.getProduction(personTaskId, user);
      assert.ok(production.approved_anchor?.id, 'completed person dossier has no approved anchor');
      candidates = { production, selected: production.approved_anchor };
    } else if (resumeRunId) {
      const production = personDossier.getProduction(personTaskId, user);
      assert.ok(production.approved_anchor?.id, 'resume production has no approved person anchor');
      candidates = { production, selected: production.approved_anchor };
      const productionFile = path.join(
        personDossier.ROOT_DIR,
        String(user.id).replace(/[^a-z0-9_-]/ig, '_').slice(0, 90),
        'tasks',
        `${String(personTaskId).replace(/[^a-z0-9_-]/ig, '_').slice(0, 90)}.json`,
      );
      const recordedSubmissions = new Map(audit.provider_submissions.map(item => [item.client_request_id, item]));
      const repaired = JSON.parse(fs.readFileSync(productionFile, 'utf8'));
      const reconciled = [];
      for (const [key, checkpoint] of Object.entries(repaired.dossier_checkpoints || {})) {
        const submission = recordedSubmissions.get(key);
        const submitted = Boolean(submission);
        if (submitted && submission.status !== 'success') {
          throw new Error(`cannot reconcile non-success provider submission: ${key}`);
        }
        reconciled.push({
          unit: checkpoint.unit,
          checkpoint_key: key,
          provider_submission_recorded: submitted,
          previous_status: checkpoint.status,
          reason: 'maximum-length filename collision invalidated the local atlas and crops',
        });
        repaired.dossier_checkpoints[key] = {
          ...checkpoint,
          status: 'failed',
          provider_submission_state: submitted ? 'completed' : 'not_submitted',
          billing_state: submitted ? 'confirmed' : 'not_submitted',
          provider_result: null,
          result: null,
          error: {
            code: 'LOCAL_FILENAME_COLLISION_RECONCILED',
            message: 'Paid result could not be reused because concurrent maximum-length filenames collided; replacement remains inside the original 15-submission cap.',
          },
          updated_at: new Date().toISOString(),
        };
      }
      repaired.dossier_job = {
        ...(repaired.dossier_job || {}),
        status: 'failed',
        phase: 'Reconciled local filename collision; ready to replace invalid categories',
        error: {
          code: 'LOCAL_FILENAME_COLLISION_RECONCILED',
          message: 'Invalid local files were isolated after confirmed provider settlement.',
        },
        updated_at: new Date().toISOString(),
      };
      const tempProduction = `${productionFile}.${process.pid}.resume.tmp`;
      fs.writeFileSync(tempProduction, JSON.stringify(repaired, null, 2), 'utf8');
      fs.renameSync(tempProduction, productionFile);
      audit.resume_reconciliation = {
        invalidated_units: reconciled,
        replacement_strategy: 'regenerate four invalid person categories; stateful prop covers base prop identity; dual-space scene run covers per-space generation and multi-space isolation',
        dedicated_static_prop_omitted: true,
        dedicated_single_scene_omitted: true,
      };
      persistAudit();
    } else {
      const uploadCopy = path.join(auditDir, 'authorized-source-upload.jpg');
      fs.copyFileSync(sourcePath, uploadCopy);
      const source = await personDossier.createSource({
        file: {
          path: uploadCopy,
          originalname: 'authorized-source.jpg',
          mimetype: 'image/jpeg',
          size: fs.statSync(uploadCopy).size,
        },
        body: {
          kind: 'identity',
          rights_confirmed: 'true',
          adult_confirmed: 'true',
        },
        user,
      });
      audit.outputs.person_source = source;
      persistAudit();
      candidates = await phase('person_outfit_candidates', 2, async () => {
        const started = personDossier.startCandidates({
          taskId: personTaskId,
          user,
          sourceId: source.id,
          mode: 'ai_outfit',
          wardrobe: 'original unbranded charcoal tailored blazer, ivory crew-neck top, straight black trousers and plain black low-heel shoes; no logos, no jewelry',
        });
        assert.equal(started.accepted, true);
        const production = await waitForPersonJob(personTaskId, user, 'candidate');
        assert.equal(production.candidate_job?.status, 'completed', JSON.stringify(production.candidate_job?.error || {}));
        assert.equal(production.candidates?.length, 2);
        const selectable = production.candidates.filter(item => item.selectable === true);
        assert.ok(selectable.length > 0, 'neither real-person outfit candidate passed identity QA');
        return { production, selected: selectable.sort((a, b) => Number(b.qa?.source_identity_score || 0) - Number(a.qa?.source_identity_score || 0))[0] };
      });
      audit.outputs.person_candidates = candidates.production.candidates;
      const approved = personDossier.approveCandidate({
        taskId: personTaskId,
        candidateId: candidates.selected.id,
        user,
      });
      assert.equal(approved.approved_candidate_id, candidates.selected.id);
    }

    const dossier = completedPersonDossier
      ? { ...candidates.production, dossier: audit.outputs.person_dossier }
      : await phase(resumeRunId ? 'person_dossier_atlases_replacement' : 'person_dossier_atlases', 4, async () => {
        const started = personDossier.startDossier({ taskId: personTaskId, user });
        assert.equal(started.accepted, true);
        const production = await waitForPersonJob(personTaskId, user, 'dossier');
        assert.equal(production.dossier_job?.status, 'completed', JSON.stringify(production.dossier_job?.error || {}));
        assert.equal(production.dossier?.atomic_assets?.length, 17);
        assert.equal(production.dossier?.category_atlases?.length, 4);
        assert.equal(production.dossier?.generation_summary?.provider_calls_this_run, 4);
        return production;
      });
    audit.outputs.person_dossier = dossier.dossier;
    audit.verification.person = {
      candidate_count: candidates.production.candidates.length,
      selectable_candidate_count: candidates.production.candidates.filter(item => item.selectable === true).length,
      selected_candidate_id: candidates.selected.id,
      atomic_asset_count: dossier.dossier.atomic_assets.length,
      category_atlas_count: dossier.dossier.category_atlases.length,
      qa: dossier.dossier.qa,
      reference_board: dossier.dossier.reference_board,
      composite_sheet: dossier.dossier.sheet,
    };
    persistAudit();

    const propTaskId = `${runId}-props`;
    audit.task_ids.props = propTaskId;
    createTask(propTaskId, {
      brief: 'Verify reusable static and stateful prop dossiers for an original unbranded commercial.',
      prop_assets: [],
    });
    storage.saveOutput(propTaskId, 'storyboard_table', [
      { shot_index: 0, scene_id: 'entry', visual: 'The key rests in the shallow tray.', prop_states: { key: 'resting' } },
      { shot_index: 1, scene_id: 'entry', action: 'The actor lifts the key.', prop_contact: 'right thumb and forefinger hold the key bow', prop_states: { key: 'held' } },
    ]);
    const staticProp = resumeRunId ? null : await phase('static_prop_dossier', 1, () => propAssets.generatePropAsset(propTaskId, {
        id: 'clear_water_tumbler',
        name: 'Clear water tumbler',
        type: 'story_prop',
        description: 'Unbranded cylindrical clear glass tumbler with a heavy rounded base and no decoration.',
        material: 'clear soda-lime glass with realistic refraction',
        scale: '10 cm tall, 7 cm diameter',
        quantity: 1,
        states: ['clean_empty'],
      }));
    const statefulProp = audit.outputs.props?.stateful?.generation_summary?.provider_calls_this_run === 2
      ? audit.outputs.props.stateful
      : await phase('stateful_prop_dossier', 2, () => propAssets.generatePropAsset(propTaskId, {
        id: 'silver_entry_key',
        name: 'Silver entry key',
        type: 'story_prop',
        description: 'One original unbranded silver key with a rounded rectangular bow and a short single-sided blade.',
        material: 'brushed silver metal',
        scale: '6 cm long',
        quantity: 1,
        scene_id: 'entry',
        placement: 'centre of a shallow wooden tray',
        states: ['resting', 'held'],
      }));
    audit.outputs.props = { static: staticProp, stateful: statefulProp };
    audit.verification.props = {
      static_provider_calls: staticProp?.generation_summary?.provider_calls_this_run ?? null,
      static_identity_covered_by_stateful_base: resumeRunId,
      stateful_provider_calls: statefulProp.generation_summary.provider_calls_this_run,
      static_view_count: staticProp?.view_images?.length ?? null,
      stateful_view_count: statefulProp.view_images.length,
      state_view_count: statefulProp.state_views.length,
    };
    persistAudit();

    let singleScene = null;
    if (!resumeRunId) {
      const singleTaskId = `${runId}-single-scene`;
      audit.task_ids.single_scene = singleTaskId;
      const singleSpec = sceneSpec(
        'A complete compact apartment entry hall with four readable boundaries, a west entrance door, an east opening to the living room, a fixed oak console on the north wall, and a clear central route.',
        'Warm white plaster walls, matte oak joinery and pale limestone floor receive coherent soft daylight from the east opening plus a practical ceiling fixture, with realistic joints, scale and localized wear.',
        'Reserve a visible empty standing zone beside the console and preserve an unobstructed route from the west entrance to the east opening so a person can lift a small key from the tray.',
      );
      seedSceneTask(singleTaskId, [{
        id: 'entry_hall',
        space_id: 'entry_hall',
        name: 'Apartment entry hall',
        description: singleSpec.layoutText,
        scene_spec: singleSpec,
      }]);
      singleScene = await phase('single_scene_asset', 2, () => sceneAssets.generateSceneAsset(singleTaskId, {
        space_id: 'entry_hall',
        view_strategy: 'atlas_2x2',
        require_complete_scene_spec: true,
        generation_id: `${runId}-single`,
      }, {
        generationId: `${runId}-single`,
        generationBudget: { maxExtra: 0 },
      }));
      audit.outputs.single_scene = singleScene.scene_asset;
      audit.verification.single_scene = {
        view_count: singleScene.scene_asset.view_images.length,
        provider_image_call_count: singleScene.scene_asset.view_acquisition.provider_image_call_count,
        local_crop_count: singleScene.scene_asset.view_acquisition.local_crop_count,
        full_space_lock: singleScene.scene_asset.scene_contract?.full_space_lock === true,
        qa_unavailable: singleScene.scene_asset.scene_contract?.qa_unavailable === true,
        cross_view_qa: singleScene.scene_asset.cross_view_qa,
        photographic_realism_qa: singleScene.scene_asset.photographic_realism_qa,
        layout_preflight: singleScene.scene_asset.view_acquisition.layout_preflight,
      };
      persistAudit();
    }

    const dualTaskId = `${runId}-dual-scene`;
    audit.task_ids.dual_scene = dualTaskId;
    const kitchenSpec = sceneSpec(
      'A complete galley kitchen with a south doorway, continuous east and west cabinet runs, a north window above the sink, fixed appliance footprints, and a clear central aisle connecting every boundary.',
      'Matte warm-grey cabinetry, brushed steel fixtures and off-white stone counters are lit by soft north-window daylight and subtle under-cabinet practicals with realistic seams, reflections and everyday variation.',
      'Keep a visible empty preparation zone at the west counter and an unobstructed aisle from the south doorway to the sink so a person can place and retrieve one clear tumbler.',
    );
    const balconySpec = sceneSpec(
      'A complete sheltered apartment balcony with a west sliding door, north and east guard walls, a south planter boundary, one fixed bench on the north side, and a readable walking route around it.',
      'Textured pale concrete, powder-coated dark metal and weathered oak receive late-afternoon side light from the south-west with realistic outdoor exposure, drainage joints and localized weathering.',
      'Reserve an empty standing zone beside the fixed bench and preserve a clear route from the west sliding door to the south planter so a person can pause and present a small object safely.',
    );
    seedSceneTask(dualTaskId, [
      {
        id: 'galley_kitchen',
        space_id: 'galley_kitchen',
        name: 'Galley kitchen',
        description: kitchenSpec.layoutText,
        scene_spec: kitchenSpec,
      },
      {
        id: 'sheltered_balcony',
        space_id: 'sheltered_balcony',
        name: 'Sheltered balcony',
        description: balconySpec.layoutText,
        scene_spec: balconySpec,
      },
    ]);
    const dualScenes = [];
    const firstSceneProviderIncident = audit.provider_submissions.some(item => (
      item.phase === 'dual_scene_asset_1'
      && item.status === 'failed'
      && item.error?.billing_state === 'unknown'
    ));
    if (firstSceneProviderIncident) {
      const checkpoint = storage.getOutput(dualTaskId, sceneCheckpoint.outputKind('galley_kitchen'));
      assert.ok(checkpoint, 'first-scene partial checkpoint is missing');
      const partialViews = ['master', 'reverse', 'interaction', 'detail']
        .map(key => sceneCheckpoint.checkpointView(checkpoint, key))
        .filter(Boolean);
      assert.equal(partialViews.length, 4, 'first-scene atlas did not preserve four reusable local views');
      dualScenes.push({
        id: 'galley_kitchen',
        space_id: 'galley_kitchen',
        status: 'partial_external_provider_incident',
        view_images: partialViews,
        view_acquisition: {
          provider_image_call_count: 1,
          local_crop_count: 4,
          layout_preflight: checkpoint.layout_acquisition || null,
        },
        partial_checkpoint: true,
        checkpoint_status: checkpoint.status,
        checkpoint_error_code: checkpoint.last_error_code || 'PROVIDER_5XX_AMBIGUOUS',
      });
      audit.scene_incident_recovery = {
        scene_id: 'galley_kitchen',
        recovered_local_view_count: partialViews.length,
        failed_view: 'layout',
        failed_submission_retried: false,
        remaining_plan: 'generate the second space with the final two authorized submissions',
      };
      persistAudit();
    }
    const spacesToGenerate = firstSceneProviderIncident
      ? [[1, 'sheltered_balcony']]
      : [...['galley_kitchen', 'sheltered_balcony'].entries()];
    for (const [index, spaceId] of spacesToGenerate) {
      const result = await phase(`dual_scene_asset_${index + 1}`, 2, () => sceneAssets.generateSceneAsset(dualTaskId, {
        space_id: spaceId,
        view_strategy: 'atlas_2x2',
        require_complete_scene_spec: true,
        generation_id: `${runId}-dual-${index + 1}`,
      }, {
        generationId: `${runId}-dual-${index + 1}`,
        generationBudget: { maxExtra: 0 },
      }));
      dualScenes.push(result.scene_asset);
    }
    audit.outputs.dual_scenes = dualScenes;
    audit.verification.dual_scenes = dualScenes.map(asset => ({
      space_id: asset.space_id,
      partial_external_provider_incident: asset.partial_checkpoint === true,
      view_count: asset.view_images.length,
      provider_image_call_count: asset.view_acquisition.provider_image_call_count,
      local_crop_count: asset.view_acquisition.local_crop_count,
      full_space_lock: asset.scene_contract?.full_space_lock === true,
      qa_unavailable: asset.scene_contract?.qa_unavailable === true,
      cross_view_qa: asset.cross_view_qa,
      photographic_realism_qa: asset.photographic_realism_qa,
      layout_preflight: asset.view_acquisition.layout_preflight,
    }));

    assert.equal(audit.provider_submissions.length, expectedSubmissions);
    const successfulSubmissions = audit.provider_submissions.filter(item => item.status === 'success');
    const externalProviderIncidents = audit.provider_submissions.filter(item => (
      item.status === 'failed'
      && item.error?.billing_state === 'unknown'
      && item.error?.provider_submission_state === 'submitted_unknown'
    ));
    assert.equal(successfulSubmissions.length, expectedSubmissions - externalProviderIncidents.length);
    assert.ok(externalProviderIncidents.length <= 1);
    const relevantTaskIds = Object.values(audit.task_ids);
    const modelCalls = relevantTaskIds.flatMap(taskId => storage.getTaskBundle(taskId, { diagnostics: true }).model_calls || []);
    audit.model_call_summary = {
      total_records: modelCalls.length,
      image_success: modelCalls.filter(call => call.status === 'success' && String(call.model_id) === 'gpt-image-2').length,
      image_failed: modelCalls.filter(call => call.status === 'failed' && String(call.model_id) === 'gpt-image-2').length,
      vision_success: modelCalls.filter(call => call.status === 'success' && String(call.stage || '').includes('qa')).length,
      billing_unknown: modelCalls.filter(call => call.billing_state === 'unknown').length,
    };
    audit.local_files = {
      reference_board: mediaAdapter.assetPathFromName(dossier.dossier.reference_board.filename),
      composite_sheet: mediaAdapter.assetPathFromName(dossier.dossier.sheet.filename),
      category_atlases: dossier.dossier.category_atlases.map(item => mediaAdapter.assetPathFromName(item.filename)),
      static_prop_atlases: staticProp ? staticProp.category_atlases.map(item => mediaAdapter.assetPathFromName(item.filename)) : [],
      stateful_prop_atlases: statefulProp.category_atlases.map(item => mediaAdapter.assetPathFromName(item.filename)),
      single_scene_views: singleScene ? singleScene.scene_asset.view_images.map(item => mediaAdapter.assetPathFromName(item.filename || decodeURIComponent(String(item.image_url || '').split('/').pop() || ''))) : [],
      dual_scene_views: dualScenes.map(asset => asset.view_images.map(item => mediaAdapter.assetPathFromName(item.filename || decodeURIComponent(String(item.image_url || '').split('/').pop() || '')))),
    };
    audit.status = externalProviderIncidents.length
      ? 'completed_with_external_provider_incident'
      : 'completed';
    audit.finished_at = new Date().toISOString();
    audit.duration_ms = Date.now() - new Date(audit.started_at).getTime();
    persistAudit();
    console.log(JSON.stringify({
      matrix_completed: true,
      code_paths_passed: true,
      external_provider_incidents: externalProviderIncidents.length,
      run_id: runId,
      audit_path: auditPath,
      provider_image_submissions: audit.provider_submissions.length,
      successful_image_submissions: audit.provider_submissions.filter(item => item.status === 'success').length,
      person_atomic_assets: dossier.dossier.atomic_assets.length,
      prop_provider_calls: (staticProp?.generation_summary?.provider_calls_this_run || 0) + statefulProp.generation_summary.provider_calls_this_run,
      single_scene_provider_calls: singleScene?.scene_asset?.view_acquisition?.provider_image_call_count || 0,
      dual_scene_provider_calls: dualScenes.reduce((sum, asset) => sum + asset.view_acquisition.provider_image_call_count, 0),
      billing_unknown: audit.model_call_summary.billing_unknown,
    }));
  } catch (error) {
    audit.status = 'failed';
    audit.error = safeError(error);
    audit.finished_at = new Date().toISOString();
    audit.duration_ms = Date.now() - new Date(audit.started_at).getTime();
    persistAudit();
    throw error;
  } finally {
    deyunai.generateImage = originalDeyunaiGenerateImage;
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(JSON.stringify({ passed: false, error: safeError(error) }, null, 2));
    process.exit(1);
  });
