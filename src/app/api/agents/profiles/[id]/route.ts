import { NextRequest, NextResponse } from 'next/server';
import { getAgentProfile, updateAgentProfile, deleteAgentProfile } from '@/lib/db';
import type { AgentProfile } from '@/lib/orchestrator/agent-profile';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const row = getAgentProfile(id);
    if (!row) {
      return NextResponse.json({ error: 'Agent profile not found' }, { status: 404 });
    }
    return NextResponse.json({
      profile: { ...JSON.parse(row.profile_json) as AgentProfile, source: row.source, created_at: row.created_at, updated_at: row.updated_at },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get agent profile' },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const existing = getAgentProfile(id);
    if (!existing) {
      return NextResponse.json({ error: 'Agent profile not found' }, { status: 404 });
    }

    const body = await request.json();
    const existingProfile = JSON.parse(existing.profile_json) as AgentProfile;

    // Merge updates into existing profile
    const updatedProfile: AgentProfile = {
      ...existingProfile,
      ...(body.displayName !== undefined && { displayName: body.displayName }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.version !== undefined && { version: body.version }),
      ...(body.orchestrator !== undefined && { orchestrator: body.orchestrator }),
      ...(body.strategyId !== undefined && { strategyId: body.strategyId }),
      ...(body.strategyOptions !== undefined && { strategyOptions: body.strategyOptions }),
      ...(body.toolProviderIds !== undefined && { toolProviderIds: body.toolProviderIds }),
      ...(body.inlineTools !== undefined && { inlineTools: body.inlineTools }),
      ...(body.systemPrompt !== undefined && { systemPrompt: body.systemPrompt }),
      ...(body.promptTemplate !== undefined && { promptTemplate: body.promptTemplate }),
      ...(body.permissionMode !== undefined && { permissionMode: body.permissionMode }),
      ...(body.permissionBrokerId !== undefined && { permissionBrokerId: body.permissionBrokerId }),
      ...(body.contextPolicyId !== undefined && { contextPolicyId: body.contextPolicyId }),
      ...(body.multiRole !== undefined && { multiRole: body.multiRole }),
      ...(body.workflow !== undefined && { workflow: body.workflow }),
      ...(body.delegate !== undefined && { delegate: body.delegate }),
      ...(body.model !== undefined && { model: body.model }),
      ...(body.providerId !== undefined && { providerId: body.providerId }),
      ...(body.maxSteps !== undefined && { maxSteps: body.maxSteps }),
      ...(body.timeoutSec !== undefined && { timeoutSec: body.timeoutSec }),
      ...(body.icon !== undefined && { icon: body.icon }),
    };

    const row = updateAgentProfile(id, {
      display_name: updatedProfile.displayName,
      description: updatedProfile.description,
      version: updatedProfile.version,
      profile_json: JSON.stringify(updatedProfile),
    });

    if (!row) {
      return NextResponse.json({ error: 'Failed to update agent profile' }, { status: 500 });
    }

    return NextResponse.json({
      profile: { ...JSON.parse(row.profile_json) as AgentProfile, source: row.source, updated_at: row.updated_at },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update agent profile' },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const deleted = deleteAgentProfile(id);
    if (!deleted) {
      return NextResponse.json({ error: 'Agent profile not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete agent profile' },
      { status: 500 },
    );
  }
}
