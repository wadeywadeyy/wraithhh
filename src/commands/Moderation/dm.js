import { SlashCommandBuilder, PermissionFlagsBits, PermissionsBitField, ChannelType, MessageFlags } from 'discord.js';
import { createEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { logEvent } from '../../utils/moderation.js';
import { logger } from '../../utils/logger.js';
import { sanitizeMarkdown } from '../../utils/validation.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';
export default {
    data: new SlashCommandBuilder()
        .setName("dm")
        .setDescription("Send a direct message to users/roles (Staff only)")
        .addUserOption(option =>
            option
                .setName("user")
                .setDescription("The user to send a DM to")
                .setRequired(false)
        )
        .addRoleOption(option =>
            option
                .setName("role")
                .setDescription("The role to send DMs to all members")
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName("message")
                .setDescription("The message to send")
                .setRequired(true)
        )
        .addBooleanOption(option =>
            option
                .setName("anonymous")
                .setDescription("Send the message anonymously (default: false)")
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .setDMPermission(true),
    category: "moderation",

    async execute(interaction, config, client) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) {
            logger.warn(`DM interaction defer failed`, {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'dm'
            });
            return;
        }

        const targetUser = interaction.options.getUser("user");
        const targetRole = interaction.options.getRole("role");
        const message = interaction.options.getString("message");
        const anonymous = interaction.options.getBoolean("anonymous") || false;

        // Validate that at least one target is provided
        if (!targetUser && !targetRole) {
            return await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'You must specify either a user or a role.' });
        }

        try {
            
            if (message.length > 2000) {
                return await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Messages must be under 2000 characters.' });
            }

            const sanitized = sanitizeMarkdown(message);
            let successCount = 0;
            let failureCount = 0;
            const failedUsers = [];

            // Handle single user DM
            if (targetUser) {
                if (targetUser.bot) {
                    return await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'You cannot send DMs to bot accounts.' });
                }

                const userSuccess = await sendDM(targetUser, sanitized, anonymous, interaction);
                if (userSuccess) {
                    successCount++;
                } else {
                    failureCount++;
                    failedUsers.push(targetUser.tag);
                }
            }

            // Handle role members DM
            if (targetRole) {
                const members = await interaction.guild.members.fetch();
                const roleMembers = members.filter(member => member.roles.has(targetRole.id) && !member.user.bot);

                if (roleMembers.size === 0) {
                    return await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'No members found with that role.' });
                }

                for (const member of roleMembers.values()) {
                    const memberSuccess = await sendDM(member.user, sanitized, anonymous, interaction);
                    if (memberSuccess) {
                        successCount++;
                    } else {
                        failureCount++;
                        failedUsers.push(member.user.tag);
                    }
                }
            }

            // Log the event
            await logEvent({
                client: interaction.client,
                guild: interaction.guild,
                event: {
                    action: "DM Sent",
                    target: targetUser ? `${targetUser.tag} (${targetUser.id})` : `Role: ${targetRole.name}`,
                    executor: `${interaction.user.tag} (${interaction.user.id})`,
                    reason: `Anonymous: ${anonymous ? 'Yes' : 'No'}`,
                    metadata: {
                        userId: targetUser?.id,
                        roleId: targetRole?.id,
                        moderatorId: interaction.user.id,
                        anonymous,
                        messageLength: sanitized.length,
                        successCount,
                        failureCount
                    }
                }
            });

            // Build response message
            let responseMessage = `Successfully sent messages to ${successCount} recipient(s)`;
            if (failureCount > 0) {
                responseMessage += ` (Failed: ${failureCount})`;
                if (failedUsers.length > 0 && failedUsers.length <= 10) {
                    responseMessage += `\n**Failed to send to:** ${failedUsers.join(', ')}`;
                }
            }

            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    successEmbed(
                        "DM Sent",
                        responseMessage
                    ),
                ],
            });
        } catch (error) {
            logger.error('DM command error:', error);
            
            return await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: `Failed to send DM: ${error.message}` });
        }
    }
};

// Helper function to send DM to a single user
async function sendDM(user, message, anonymous, interaction) {
    try {
        const dmChannel = await user.createDM();
        
        await dmChannel.send({
            embeds: [
                successEmbed(
                    anonymous ? "Message from the Staff Team" : `Message from ${interaction.user.tag}`,
                    message
                ).setFooter({
                    text: `You cannot reply to this message. | Logger ID: ${interaction.id}`
                })
            ]
        });

        return true;
    } catch (error) {
        if (error.code === 50007) {
            logger.warn(`Could not send DM to ${user.tag}: DMs disabled`);
        } else {
            logger.warn(`Could not send DM to ${user.tag}:`, error);
        }
        return false;
    }
}
